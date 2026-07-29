"""Tests for the medicine-line gate.

Every rejection case here is a line that was observed producing a fabricated
medicine on a real prescription or referral letter; every acceptance case is a
real drug line that must survive. The asymmetry matters: a wrongly kept line
becomes a drug the clinician has to disprove, but a wrongly dropped line is a
medicine they never see at all — so the acceptance cases are the stricter test.

Fast and dependency-free (no OCR, no model loading):

    PYTHONPATH=. python backend/ocr/tests/test_line_filter.py
    PYTHONPATH=. pytest backend/ocr/tests/test_line_filter.py
"""

from __future__ import annotations

from backend.ocr.line_filter import _reads_as_prose, is_medicine_line

HIGH = 0.9  # a confidence well above the floor, so only the text is under test


# Lines that must NOT reach the medicine index, with the drug each one invented.
REJECT = [
    ("To whom so ever it may concern", "prose"),
    ("This is to inform that Mr CH SAMUEL 62yr Male", "prose"),
    ("is currently admitted under my care with IP NO 367588", "prose"),
    ("He is currently undergoing treatment in ICU for", "prose"),
    ("he further needs hospital stay", "prose -> 'need syrup'"),
    ("for about 8-10 days for complete recovery", "prose"),
    ("Dr B. Who", "title -> 'dr 4 tablet'"),
    ("Dr. D. Ravi Shankar", "title"),
    ("Ms/Mr Patient 30", "title -> 'movexx mr tablet'"),
    ("INSTITUTES OF GASTROENTEROLOGY", "letterhead -> 'gastro 20 tablet'"),
    ("Preethi Child Clinic", "letterhead"),
    ("In Case of Emergency Contact", "letterhead"),
    ("Ph: 9989102020", "phone number"),
    ("Timings: 10.00 AM to 1.00 PM", "clock time"),
    ("9.00 AM to 10.00 am", "clock time"),
    ("Name", "form label"),
    ("Date", "form label"),
    ("age: 70 years", "form label"),
    ("0-0-1 X 1 week", "dosing grid, not a name"),
    ("1Omg", "too few letters"),
]

# Lines this gate deliberately lets through. They are garbled fragments rather
# than identifiable non-medicine text, so gate 1 cannot judge them on shape
# alone — the match-confirmation gate is what stops them being named. Recorded
# here so the division of responsibility is explicit: "22lull)" (a mangled date)
# reaches the index but resolves to nothing, which is the intended outcome.
PASSES_GATE_ONE = ["22lull)", "coll", "Hlzale"]

# Real drug lines that must survive the gate.
ACCEPT = [
    "Cetirizine",
    "Paracetamol 650mg",
    "Digoxin 0.125 mg",
    "Oflazest OZ",
    "Azenac MR",              # MR is a modified-release suffix, not the title "Mr"
    "Stilbestrol 25mg",
    "Advent drops",
    "T-Minic",
    "Amoxycillin 500",
    "TAB ANDIAL",
    "Cocaine Hydrochlor",
    "Nanoclear nasal drops",
    "HH-zole cream",
    "Augmentin 625 duo",
    "Pantop 40",
    "Zerodol SP",
]


def test_rejects_non_medicine_lines():
    for text, why in REJECT:
        ok, reason = is_medicine_line(text, HIGH)
        assert not ok, f"should have rejected ({why}): {text!r}"
        assert reason, f"rejection must explain itself: {text!r}"


def test_accepts_real_drug_lines():
    for text in ACCEPT:
        ok, reason = is_medicine_line(text, HIGH)
        assert ok, f"wrongly rejected a real drug line: {text!r} ({reason})"


def test_garbled_fragments_pass_to_the_confirmation_gate():
    """Gate 1 judges shape; unidentifiable fragments are gate 2's job."""
    for text in PASSES_GATE_ONE:
        ok, _ = is_medicine_line(text, HIGH)
        assert ok, f"gate 1 should defer {text!r} to match confirmation"


def test_low_ocr_confidence_is_rejected():
    # The engine read this at 0.7% confidence on a real prescription.
    ok, reason = is_medicine_line("AbEadwcs Bente HLa_Chlldron Hospltal", 0.007)
    assert not ok and "confidence" in reason


def test_missing_confidence_does_not_reject():
    """Cloud providers report no per-line confidence; that must not fail the gate."""
    ok, _ = is_medicine_line("Paracetamol 650mg", None)
    assert ok


def test_title_check_is_first_token_only():
    """'MR' inside a name is a formulation suffix, not the honorific."""
    assert is_medicine_line("Azenac MR", HIGH)[0]
    assert not is_medicine_line("Mr Azenac", HIGH)[0]


def test_prose_rule_spares_short_lines():
    """Two-word drug lines may contain an ordinary word ('Advent drops')."""
    assert not _reads_as_prose(["advent", "drops"])
    assert _reads_as_prose(["to", "whom", "it", "may", "concern"])


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
