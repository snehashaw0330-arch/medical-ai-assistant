"""Pediatric safety chain: patient age must change the clinical verdict.

Phase 3 regression guard. The measured failure this protects against: the real
6-month-old prescription (backend/history/images/016e98c0d5d44420a42623dcb72e183f.jpg,
four medications) reached clinical decision support with ``age=None`` and was
graded ``risk: low, warnings: 0``. These tests pin the rules-engine half of the
fix: once an infant age arrives, the report can never read "low" again.

    PYTHONPATH=. python backend/clinical_decision/tests/test_pediatric_rules.py
    PYTHONPATH=. pytest backend/clinical_decision/tests/test_pediatric_rules.py
"""

from __future__ import annotations

from backend.clinical_decision.risk_analyzer import assess
from backend.clinical_decision.rules_engine import ClinicalContext, evaluate
from backend.clinical_decision.schemas import RiskLevel

# The medicines actually on the infant prescription (none is a known
# pediatric-caution drug — the age alone must carry the warning).
INFANT_MEDICINES = ["T-Minic", "Advent", "HH-zole", "Nanoclear"]


def test_infant_raises_a_red_flag():
    findings = evaluate(ClinicalContext(age=0, medicines=INFANT_MEDICINES))
    age_flags = [f for f in findings.red_flags if f.category == "age"]
    assert age_flags, "no age red flag for a 6-month-old"
    assert age_flags[0].severity == RiskLevel.MODERATE


def test_infant_case_never_grades_low():
    """The exact measured defect: infant + 4 drugs must not read risk: low."""
    findings = evaluate(ClinicalContext(age=0, medicines=INFANT_MEDICINES))
    level, score = assess(findings, interaction_report=None)
    assert level != RiskLevel.LOW, f"infant case still grades {level.value}"
    assert score >= 45.0, f"score {score} below the moderate floor"


def test_pediatric_caution_drug_grades_high():
    """A caution-table drug (aspirin -> Reye's) must outrank the infant flag."""
    findings = evaluate(ClinicalContext(age=6, medicines=["Aspirin"]))
    level, _ = assess(findings, interaction_report=None)
    assert level == RiskLevel.HIGH
    assert any("aspirin" in c.lower() for c in findings.contraindications)


def test_adult_is_not_flagged_as_infant():
    findings = evaluate(ClinicalContext(age=30, medicines=INFANT_MEDICINES))
    assert not [f for f in findings.red_flags if f.category == "age"]


def test_missing_age_is_reported_not_silent():
    """When age never arrives, the report must say so instead of implying safety."""
    findings = evaluate(ClinicalContext(age=None, medicines=INFANT_MEDICINES))
    assert any("age" in m.lower() for m in findings.missing_information)


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
