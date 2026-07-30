"""Tests for medicine-name matching and the tiered acceptance rule.

Every case below is drawn from a real prescription, letterhead or referral letter
processed during the overhaul — nothing here is hypothetical.

The rule under test exists because name similarity alone provably cannot separate
the two populations. "Arthakind drops" -> "asthakind tablet" (a real drug, one
character misread) and the prose fragment "needb" -> "need syrup" both score
exactly 88.9. What distinguishes them is not the name but the *line*: a real
prescription states a dose, a frequency, a duration or a form. So an unambiguous
name match stands on its own, and a merely plausible one must be corroborated.

    PYTHONPATH=. python backend/ocr/tests/test_matching.py
    PYTHONPATH=. pytest backend/ocr/tests/test_matching.py
"""

from __future__ import annotations

from backend.config import settings
from backend.ocr.medicine_intelligence import confirm_score

STRONG = settings.MEDICINE_CONFIRM_STRONG
FLOOR = settings.MEDICINE_CONFIRM_THRESHOLD


def accepts(query: str, name: str, *, structure: bool) -> bool:
    """Mirror of the acceptance rule in pipeline._process_segment."""
    c = confirm_score(query, name)
    return c >= STRONG or (c >= FLOOR and structure)


# (ocr query, candidate, line carries dose/frequency/duration/form)
REAL = [
    ("Arthakind drops 0.4ml TDS 3 days", "asthakind tablet", True),
    ("Advent drops 0.8ml TDS 3 days", "advent 625 tablet", True),
    ("Paracetamol 650mg TDS after food", "paracetamol tablet", True),
    ("Nasoclear nasal drops", "nasoclear plus nasal drops", True),
    ("Digoxin 0.125mg", "digoxin 0.25mg tablet", True),
    ("Amlodipine 5mg", "amlodpin 5mg tablet", True),
    ("Cetirizine", "cetirizine 10mg tablet", False),
    ("Zofer MD", "zofer md 4 tablet", False),
    ("Oflazest OZ", "oflazest oz 200mg/500mg tablet", False),
    ("Omeprazole", "omeparazole 20mg capsule", False),
    ("Andial", "andial 2mg tablet", False),
    ("T-Minic", "t-minic syrup", False),
]

NOISE = [
    ("days", "days sr 50mg/10mg tablet", False),
    ("TDS after food", "lafter 10 tablet", True),
    ("needb", "need syrup", False),
    ("Wu Om", "om suspension", False),
    ("date", "dat cream", False),
    ("Name", "nam tablet", False),
    ("coll", "collintus syrup", False),
    ("Hlzale", "al 27 tablet", False),
    ("Ternp _G1.", "t-98 tablet", False),
    ("Adunt &ul", "a 250 suspension", False),
    ("Ms/Mr", "movexx mr tablet", False),
    ("he further needs hospital stay", "need syrup", False),
]


def test_real_medicines_are_accepted():
    for q, n, structure in REAL:
        assert accepts(q, n, structure=structure), (
            f"lost a real drug: {q!r} -> {n!r} (confirm {confirm_score(q, n):.1f})"
        )


def test_noise_is_rejected():
    for q, n, structure in NOISE:
        assert not accepts(q, n, structure=structure), (
            f"named a non-drug: {q!r} -> {n!r} (confirm {confirm_score(q, n):.1f})"
        )


def test_structure_is_what_breaks_the_tie():
    """The same score accepts or rejects depending on corroboration."""
    real = confirm_score("Arthakind drops 0.4ml TDS 3 days", "asthakind tablet")
    noise = confirm_score("needb", "need syrup")
    assert abs(real - noise) < 0.5, "these are meant to be indistinguishable by name"
    assert FLOOR <= real < STRONG, "the tie-break band moved; revisit the thresholds"
    assert accepts("Arthakind drops 0.4ml TDS 3 days", "asthakind tablet", structure=True)
    assert not accepts("needb", "need syrup", structure=False)


def test_short_names_need_the_whole_query():
    """2-3 character brands must not harvest stray fragments."""
    assert confirm_score("Wu Om", "om suspension") < FLOOR
    assert confirm_score("om", "om suspension") >= STRONG


def test_subset_match_needs_a_distinctive_token():
    """token_set_ratio credits subsets; that is only evidence when it means something."""
    assert confirm_score("days", "days sr 50mg tablet") < FLOOR     # 'days' too short
    assert confirm_score("nasoclear", "nasoclear plus") >= STRONG   # distinctive


def test_function_words_are_never_the_drug_name():
    """'after' must not carry a match to 'lafter'."""
    assert confirm_score("TDS after food", "lafter 10 tablet") < FLOOR


def test_strength_tokens_do_not_penalise_a_correct_match():
    """normalize() leaves a fused '650mg' behind; identity comparison must not."""
    assert confirm_score("Paracetamol 650mg", "paracetamol tablet") >= STRONG
    assert confirm_score("Stilbestrol 25mg", "stilbestrol tablet") >= STRONG


def test_ranking_prefers_identity_over_substring():
    """Searching a real drug must surface the real product, not a shorter lookalike."""
    from backend.ocr.medicine_intelligence import get_index

    top = get_index().search("Omeprazole", limit=1)
    assert top, "no candidates returned"
    assert confirm_score("Omeprazole", top[0].name) >= STRONG, (
        f"ranked {top[0].name!r} above the real product"
    )


def test_leading_dose_form_abbreviation_is_stripped():
    """"T." means Tablet and must go; "T-Minic" is the drug and must stay.

    The period is the whole signal, which is why this cannot be a bare "t" in
    _FORM_WORDS. Measured on 33.jpg: with the prefix left in, "T. Azee 500mg"
    and "T. Dolo 650" went unresolved and "T. Pan 40mg" matched the unrelated
    product "t pan 40mg tablet".
    """
    from backend.ocr.medicine_intelligence import strip_leading_form_abbrev as strip

    assert strip("T. Pan 40mg") == "Pan 40mg"
    assert strip("Cap. Phexin 500mg") == "Phexin 500mg"
    assert strip("Inj. Remdesivir") == "Remdesivir"
    # A name that merely begins with a letter must survive untouched.
    assert strip("T-Minic drops") == "T-Minic drops"
    assert strip("T Minic") == "T Minic"
    assert strip("Pan 40mg") == "Pan 40mg"


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
