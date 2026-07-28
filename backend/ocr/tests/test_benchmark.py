"""Tests for the Phase 0 benchmark's scoring math.

The harness is the ruler every later phase is measured with, so it has to be
right before its numbers mean anything. These tests use fake pipeline results
and never touch OCR, so the whole file runs in well under a second.

Runnable two ways::

    pytest backend/ocr/tests/test_benchmark.py
    PYTHONPATH=. python backend/ocr/tests/test_benchmark.py
"""

from __future__ import annotations

from pathlib import Path

from backend.ocr.benchmark import (
    GoldMedicine,
    Label,
    aggregate,
    assign,
    cer,
    name_agreement,
    normalize_frequency,
    normalize_strength,
    score_image,
    wer,
)


# ==========================================================================
# Fakes — the shape score_image() reads off a PrescriptionResult
# ==========================================================================
class FakeMedicine:
    def __init__(self, name=None, dosage=None, frequency=None, raw_text="",
                 needs_review=False):
        self.name = name
        self.dosage = dosage
        self.frequency = frequency
        self.raw_text = raw_text
        self.needs_review = needs_review if name else True


class FakeResult:
    def __init__(self, medicines, raw_text=""):
        self.medicines = medicines
        self.raw_text = raw_text
        self.provider = "ensemble:easyocr"
        self.best_engine = "easyocr"


def make_label(medicines, *, raw_text=None, certain=True, split="handwritten"):
    return Label(
        image="test.jpg",
        image_path=Path("test.jpg"),
        split=split,
        source="test",
        certain=certain,
        raw_text=raw_text,
        medicines=medicines,
        label_file=Path("test.json"),
    )


# ==========================================================================
# Name matching
# ==========================================================================
def test_name_agreement_strips_form_words():
    """`Advent` must match the dictionary's display name `advent drops`."""
    score, rule = name_agreement("Advent", "advent drops")
    assert (score, rule) == (100.0, "exact"), (score, rule)


def test_name_agreement_allows_trailing_descriptor():
    score, rule = name_agreement("Nanoclear", "nanoclear nasal")
    assert rule == "prefix" and score == 95.0, (score, rule)


def test_name_agreement_rejects_substring_fragments():
    """The defect under test: a fragment inside a long SKU is NOT a match.

    `fuzz.WRatio` returns ~90 for these, which is why the benchmark refuses to
    score with it — doing so would hide the exact bug it exists to expose.
    """
    for gold, predicted in [
        ("Advent", "c sora ointment"),
        ("Date", "dat cream"),
        ("Timings", "t-98 tablet"),
    ]:
        score, _ = name_agreement(gold, predicted)
        assert score < 88.0, f"{gold!r} vs {predicted!r} scored {score}"


def test_name_agreement_distinguishes_unrelated_drugs():
    score, _ = name_agreement("Cetirizine", "Omeprazole")
    assert score < 88.0, score


# ==========================================================================
# Field normalisation
# ==========================================================================
def test_frequency_notations_collapse_to_doses_per_day():
    assert normalize_frequency("0-0-1") == "1x/day"
    assert normalize_frequency("OD") == "1x/day"
    assert normalize_frequency("once daily") == "1x/day"
    assert normalize_frequency("1-1-1") == normalize_frequency("TDS") == "3x/day"
    assert normalize_frequency("twice daily") == normalize_frequency("BD") == "2x/day"
    # Volume-per-slot schedules, as written on paediatric prescriptions.
    assert normalize_frequency("0.3ml-0.3ml-0.3ml") == "3x/day"
    assert normalize_frequency("SOS") == "prn"
    assert normalize_frequency(None) is None


def test_frequency_does_not_collapse_different_schedules():
    assert normalize_frequency("0-0-1") != normalize_frequency("1-1-1")


def test_strength_normalisation():
    assert normalize_strength("10 MG") == normalize_strength("10mg") == "10mg"
    assert normalize_strength("2.50 ml") == "2.5ml"
    assert normalize_strength("500gm") == "500g"
    assert normalize_strength(None) is None


# ==========================================================================
# CER / WER
# ==========================================================================
def test_cer_wer_are_zero_on_a_perfect_read():
    text = "Cetirizine 10mg 0-0-1 x 1 week"
    assert cer(text, text) == 0.0
    assert wer(text, text) == 0.0


def test_cer_wer_ignore_case_and_whitespace():
    assert cer("Cetirizine 10mg", "  cetirizine   10MG ") == 0.0


def test_cer_wer_none_without_a_reference():
    assert cer("", "anything") is None
    assert wer("", "anything") is None


# ==========================================================================
# Assignment
# ==========================================================================
def test_assignment_is_one_to_one():
    """One prediction can never satisfy two gold rows."""
    gold = [GoldMedicine(name="Advent"), GoldMedicine(name="Advent")]
    claims = [FakeMedicine(name="advent drops")]
    pairs, matched_gold, matched_claims = assign(gold, claims)
    assert len(pairs) == 1 and len(matched_gold) == 1 and len(matched_claims) == 1


def test_assignment_is_best_first_not_first_fit():
    """Each gold row is taken by its closest claim, not by list order."""
    gold = [GoldMedicine(name="Cetrizin"), GoldMedicine(name="Cetirizine")]
    claims = [FakeMedicine(name="cetirizine tablet"), FakeMedicine(name="cetrizin tablet")]
    pairs, _, _ = assign(gold, claims)
    paired = {gold[gi].name: claims[ci].name for gi, ci, _, _ in pairs}
    assert paired == {"Cetirizine": "cetirizine tablet", "Cetrizin": "cetrizin tablet"}


# ==========================================================================
# Scoring a prescription
# ==========================================================================
def test_perfect_prescription_scores_clean():
    label = make_label([
        GoldMedicine(name="Cetirizine", strength="10mg", frequency="0-0-1"),
    ])
    result = FakeResult([
        FakeMedicine(name="cetirizine tablet", dosage="10mg", frequency="0-0-1"),
    ])
    s = score_image(label, result)
    assert (s.true_positives, s.false_positives, s.false_negatives) == (1, 0, 0)
    assert (s.strength_expected, s.strength_correct) == (1, 1)
    assert (s.frequency_expected, s.frequency_correct) == (1, 1)


def test_invented_medicine_is_a_false_positive():
    """The 31-medicine bug, in miniature: this is the number that catches it."""
    label = make_label([GoldMedicine(name="Advent")])
    result = FakeResult([
        FakeMedicine(name="advent drops"),
        FakeMedicine(name="metformin tablet"),      # not on the page
        FakeMedicine(name="amlodipine tablet"),     # not on the page
    ])
    s = score_image(label, result)
    assert s.true_positives == 1
    assert s.false_positives == 2
    assert s.invented == ["metformin tablet", "amlodipine tablet"]


def test_unresolved_rows_cost_recall_but_are_not_false_positives():
    """An unnamed row is "please check this", not an invented drug.

    Counting it as a false positive would reward dropping a doubtful row over
    surfacing it for review — backwards for a clinician-in-the-loop tool.
    """
    label = make_label([GoldMedicine(name="Advent"), GoldMedicine(name="HH-zole")])
    result = FakeResult([
        FakeMedicine(name="advent drops"),
        FakeMedicine(raw_text="Hlzale", needs_review=True),   # unreadable
    ])
    s = score_image(label, result)
    assert s.false_positives == 0
    assert s.false_negatives == 1        # HH-zole was missed
    assert s.unresolved == 1
    assert s.claimed == 1


def test_uncertain_gold_medicine_is_excluded_from_both_sides():
    """`certain: false` must neither inflate nor deflate the score.

    The label schema promises this; scoring an unreadable transcription as truth
    would make recall a measure of the transcriber's guessing, not the pipeline's.
    """
    label = make_label([
        GoldMedicine(name="Advent", certain=True),
        GoldMedicine(name="Arthakind", certain=False),
    ])

    # A prediction landing on the uncertain item is neither credited nor punished.
    hit = score_image(label, FakeResult([
        FakeMedicine(name="advent drops"), FakeMedicine(name="arthakind drops"),
    ]))
    assert (hit.true_positives, hit.false_positives, hit.false_negatives) == (1, 0, 0)
    assert hit.matched_uncertain == 1

    # Missing it is not a false negative either.
    miss = score_image(label, FakeResult([FakeMedicine(name="advent drops")]))
    assert (miss.true_positives, miss.false_positives, miss.false_negatives) == (1, 0, 0)


def test_invented_field_values_are_counted_separately():
    label = make_label([GoldMedicine(name="Advent", strength=None, frequency=None)])
    result = FakeResult([
        FakeMedicine(name="advent drops", dosage="650mg", frequency="1-1-1"),
    ])
    s = score_image(label, result)
    assert s.strength_expected == 0 and s.strength_invented == 1
    assert s.frequency_expected == 0 and s.frequency_invented == 1


def test_wrong_field_value_on_a_correct_drug():
    label = make_label([GoldMedicine(name="Cetirizine", strength="10mg", frequency="0-0-1")])
    result = FakeResult([
        FakeMedicine(name="cetirizine tablet", dosage="5mg", frequency="1-1-1"),
    ])
    s = score_image(label, result)
    assert s.true_positives == 1
    assert (s.strength_expected, s.strength_correct) == (1, 0)
    assert (s.frequency_expected, s.frequency_correct) == (1, 0)


# ==========================================================================
# Aggregation
# ==========================================================================
def test_aggregate_reproduces_the_old_metrics_blind_spot():
    """The scenario the previous metric read as ~100%.

    Two prescriptions, one real drug each, six invented drugs between them.
    `medicine_extraction_accuracy` (images yielding >=1 medicine / images) = 1.0.
    Precision here is 0.25 and FP/Rx is 3.0 — the bug is visible immediately.
    """
    label = make_label([GoldMedicine(name="Advent")])
    noisy = FakeResult([
        FakeMedicine(name="advent drops"),
        FakeMedicine(name="metformin tablet"),
        FakeMedicine(name="amlodipine tablet"),
        FakeMedicine(name="sertraline tablet"),
    ])
    agg = aggregate([score_image(label, noisy), score_image(label, noisy)])
    assert agg["precision"] == 0.25
    assert agg["recall"] == 1.0
    assert agg["false_positives_per_prescription"] == 3.0


def test_aggregate_handles_an_empty_set_without_dividing_by_zero():
    agg = aggregate([])
    assert agg["prescriptions"] == 0
    assert agg["precision"] == agg["recall"] == agg["f1"] == 0.0
    assert agg["cer"] is None


def test_aggregate_skips_unscored_images():
    from backend.ocr.benchmark import ImageScore

    scores = [
        score_image(make_label([GoldMedicine(name="Advent")]),
                    FakeResult([FakeMedicine(name="advent drops")])),
        ImageScore(image="gone.jpg", split="printed", status="missing-image"),
        ImageScore(image="boom.jpg", split="printed", status="failed", error="x"),
    ]
    agg = aggregate(scores)
    assert agg["prescriptions"] == 1
    assert agg["precision"] == 1.0


# ==========================================================================
# Built-in runner (no pytest required)
# ==========================================================================
if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    passed = 0
    for t in tests:
        try:
            t()
            print(f"PASS  {t.__name__}")
            passed += 1
        except Exception as exc:  # noqa: BLE001
            print(f"FAIL  {t.__name__}: {exc}")
    print(f"\n{passed}/{len(tests)} tests passed")
    raise SystemExit(0 if passed == len(tests) else 1)
