"""Symptom resolution must refuse to guess, and prediction must refuse to rank.

Phase 4 regression guard. The measured failure this protects against: a user
typed an HIV/AIDS-related term into the symptom checker and the app answered
"AIDS". Three defects stacked:

1. ``fuzz.WRatio`` returns 90 for any substring, and "hiv" is a substring of
   s-**hiv**-ering — so "hiv" silently resolved to the symptom "shivering"
   (score 90, cutoff 82) and was fed to the model as if the user had typed it.
2. ``suggest()`` called ``process.extract`` with no ``score_cutoff``, so it
   always returned 8 results however bad: "xyzzy" offered *dizziness*,
   "asdfgh" offered *skin rash*. Autocomplete advertised terms its own matcher
   would then reject.
3. A single symptom still produced a ranked diagnosis — a lone "headache"
   returned "Paralysis (brain hemorrhage)" at 22.85%.

    PYTHONPATH=. python backend/disease/tests/test_symptom_matching.py
    PYTHONPATH=. pytest backend/disease/tests/test_symptom_matching.py
"""

from __future__ import annotations

from backend.disease.service import MIN_SYMPTOMS, get_service

# Disease names, abbreviations and keyboard mash. None is a symptom; the
# matcher must map all of them to nothing rather than to something adjacent.
NOT_SYMPTOMS = ["hiv", "aids", "cancer", "covid", "tb", "flu", "diabetes",
                "xyzzy", "asdfgh"]

# Misspellings and lay phrasing a real user types. These must keep resolving —
# a stricter matcher is only useful if it stays useful.
REAL_TYPOS = {
    "vomitting": "vomiting",
    "high feaver": "high_fever",
    "loss of apetite": "loss_of_appetite",
    "yellowish skin": "yellowish_skin",
    "skin rash": "skin_rash",
}


def test_disease_names_never_resolve_to_a_symptom():
    matcher = get_service().matcher
    wrong = {
        q: matcher.match_one(q).matched
        for q in NOT_SYMPTOMS
        if matcher.match_one(q).matched is not None
    }
    assert not wrong, f"resolved to a symptom instead of nothing: {wrong}"


def test_hiv_does_not_become_shivering():
    # The exact reported failure, pinned on its own so a regression names itself.
    assert get_service().matcher.match_one("hiv").matched is None


def test_real_typos_still_resolve():
    matcher = get_service().matcher
    for typed, expected in REAL_TYPOS.items():
        assert matcher.match_one(typed).matched == expected, f"{typed!r} stopped resolving"


def test_autocomplete_offers_nothing_for_a_non_symptom():
    matcher = get_service().matcher
    noisy = {q: matcher.suggest(q, 8) for q in NOT_SYMPTOMS}
    assert not any(noisy.values()), f"autocomplete invented symptoms: {noisy}"


def test_autocomplete_completes_a_prefix():
    matcher = get_service().matcher
    assert "headache" in matcher.suggest("head", 8)
    assert "chest pain" in matcher.suggest("chest", 8)


def test_autocomplete_never_offers_what_the_matcher_would_reject():
    # The invariant behind defect 2: anything offered must survive submission.
    matcher = get_service().matcher
    for probe in ["head", "vomit", "yellow", "breath", "chest", "skin"]:
        for offered in matcher.suggest(probe, 8):
            assert matcher.match_one(offered).matched is not None, (
                f"suggest({probe!r}) offered {offered!r}, which match_one rejects"
            )


def test_a_single_symptom_produces_no_ranked_diagnosis():
    result = get_service().predict(["headache"], top_k=3)
    assert result.predictions == [], "one symptom still produced a ranked diagnosis"
    assert result.warnings, "refusing to rank must be explained"


def test_a_vague_pair_produces_no_ranked_diagnosis():
    # Above MIN_SYMPTOMS but with a flat distribution — the second floor.
    result = get_service().predict(["headache", "fatigue"], top_k=3)
    assert result.predictions == []


def test_a_specific_picture_still_gets_an_assessment():
    # The floors must not swallow legitimate use: measured realistic inputs
    # land at 27-38% top probability, well above MIN_TOP_PROBABILITY.
    result = get_service().predict(
        ["excessive_hunger", "polyuria", "fatigue", "weight_loss", "increased_appetite"],
        top_k=3,
    )
    assert result.predictions, "a specific 5-symptom picture must still be assessed"
    assert result.predictions[0].disease == "Diabetes"


def test_unrecognised_input_is_reported_not_dropped():
    result = get_service().predict(["hiv"], top_k=3)
    assert "hiv" in result.unmatched_inputs, "unknown input vanished silently"
    assert result.predictions == []


def test_explanation_does_not_assert_a_diagnosis():
    result = get_service().predict(
        ["excessive_hunger", "polyuria", "fatigue", "weight_loss", "increased_appetite"],
        top_k=1,
    )
    text = result.predictions[0].explanation.lower()
    # The old template read "Your reported X is commonly seen in <disease>",
    # which asserts a clinical relationship the model never established.
    assert "your reported" not in text
    assert "not a diagnosis" in text


def test_min_symptoms_floor_is_at_least_two():
    assert MIN_SYMPTOMS >= 2


def test_condition_terms_are_named_in_the_warning():
    # The user must be told *why* their input was dropped, even when the
    # refusal branch fires for a different reason (too few symptoms left).
    result = get_service().predict(["hiv", "high_fever"], top_k=3)
    joined = " ".join(result.warnings).lower()
    assert "hiv" in joined and "condition" in joined


def test_fuzzy_matches_are_disclosed():
    result = get_service().predict(
        ["vomitting", "high feaver", "fatigue", "chills", "muscle pain"], top_k=3
    )
    joined = " ".join(result.warnings).lower()
    assert "interpreted" in joined, "a guessed spelling was substituted silently"


# Short English words that are accidental *substrings* of symptom labels, and
# none of them a condition name — so they reach the fuzzy matcher rather than
# being caught by the CONDITION_TERMS stop-list. Under fuzz.WRatio every one of
# these scores exactly 90 (its partial-match ceiling) and would be silently
# accepted: "and" -> cold hands and feets, "eat" -> breathlessness, "art" ->
# fast heart rate. This is the general defence; the stop-list is curated and can
# never be complete, so it must not be the only thing standing here.
SUBSTRING_TRAPS = ["and", "old", "art", "ell", "urn", "ail", "sug"]


def test_accidental_substrings_do_not_resolve():
    matcher = get_service().matcher
    wrong = {
        q: matcher.match_one(q).matched
        for q in SUBSTRING_TRAPS
        if matcher.match_one(q).matched is not None
    }
    assert not wrong, (
        f"substring matched as a symptom: {wrong}. "
        "This is the fuzz.WRatio partial-match bug returning."
    )


# ---------------------------------------------------------------------------
# The same input reaches the model through TWO matchers: backend/disease (the
# Disease Prediction page) and backend/symptom_checker (the Symptom Checker
# page). Both had the identical WRatio defect, so both are pinned here —
# fixing one and shipping the other is exactly how this bug survives.
# ---------------------------------------------------------------------------

def test_symptom_checker_matcher_rejects_conditions_too():
    from backend.symptom_checker.symptom_matcher import get_matcher
    matcher = get_matcher()
    wrong = {
        q: matcher.match(q).matched
        for q in NOT_SYMPTOMS
        if matcher.match(q).matched is not None
    }
    assert not wrong, f"symptom-checker matcher resolved: {wrong}"


def test_symptom_checker_matcher_rejects_substrings_too():
    from backend.symptom_checker.symptom_matcher import get_matcher
    matcher = get_matcher()
    wrong = {
        q: matcher.match(q).matched
        for q in SUBSTRING_TRAPS
        if matcher.match(q).matched is not None
    }
    assert not wrong, f"symptom-checker matcher resolved substrings: {wrong}"


def test_symptom_checker_autocomplete_offers_nothing_for_a_non_symptom():
    from backend.symptom_checker.symptom_matcher import get_matcher
    matcher = get_matcher()
    # SUBSTRING_TRAPS matter as much as NOT_SYMPTOMS here: the condition
    # stop-list catches the latter before autocomplete's matching logic runs,
    # so on their own they cannot detect a regression to plain `q in s`
    # containment — which is what admitted "hiv" inside "shivering".
    noisy = {
        q: matcher.suggest(q, 8)
        for q in NOT_SYMPTOMS + SUBSTRING_TRAPS
        if matcher.suggest(q, 8)
    }
    assert not noisy, f"symptom-checker autocomplete invented: {noisy}"


def test_symptom_checker_names_a_condition_as_such():
    # Not merely "unrecognised": the user needs to know their input was a
    # condition, or they will just reword it until something sticks.
    from backend.symptom_checker.symptom_matcher import get_matcher
    assert get_matcher().match("aids").method == "condition"
    assert get_matcher().match("hiv").method == "condition"


def test_symptom_checker_still_resolves_real_input():
    from backend.symptom_checker.symptom_matcher import get_matcher
    matcher = get_matcher()
    for typed in ["head ache", "vomitting", "high feaver", "chest pain"]:
        assert matcher.match(typed).matched is not None, f"{typed!r} stopped resolving"


def _run() -> int:
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"PASS  {t.__name__}")
        except AssertionError as exc:
            failed += 1
            print(f"FAIL  {t.__name__}: {exc}")
    print(f"\n{len(tests) - failed}/{len(tests)} tests passed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(_run())
