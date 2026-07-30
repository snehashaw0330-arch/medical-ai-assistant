"""Tests for the vision-LLM (VLM) extraction path, without needing an API key.

The cloud providers are the intended primary recognition path — the local
EasyOCR/Tesseract ensemble cannot read cursive handwriting, so a vision model is
what makes real accuracy possible. But that path only runs when GEMINI_API_KEY or
OPENAI_API_KEY is set, which means it is the *least* exercised code in the
pipeline and would rot silently.

These tests feed canned model replies through the real parser and the real
segment processor, so the contract is verified offline: structured fields must
survive as segment hints and reach the extracted medicine, rather than being
flattened back into a text blob for the regex parser to guess at.

    PYTHONPATH=. python backend/ocr/tests/test_vision_provider.py
    PYTHONPATH=. pytest backend/ocr/tests/test_vision_provider.py
"""

from __future__ import annotations

import json

from backend.ocr.parser import age_to_years, parse_fields
from backend.ocr.pipeline import _merge_vlm_fields, _process_segment
from backend.ocr.providers._json import parse_vision_json
from backend.ocr.providers.base import RawOCRResult
from backend.ocr.schemas import PrescriptionFields

REPLY = json.dumps({
    "medicines": [
        {"medicine": "Paracetamol", "dosage": "650mg", "frequency": "TDS", "duration": "3 days"},
        {"medicine": "Cetirizine", "dosage": "10mg", "frequency": "0-0-1", "duration": "1 week"},
    ],
    "doctor_notes": ["Take after food"],
    "raw_text": "Paracetamol 650mg TDS 3 days\nCetirizine 10mg 0-0-1 1 week",
})

# Modelled on the real infant prescription (backend/history/images/016e...jpg):
# demographics live in a short form line that used to be dropped entirely.
INFANT_REPLY = json.dumps({
    "medicines": [
        {"medicine": "T-Minic drops", "dosage": "", "frequency": "0.3ml-0.3ml-0.3ml", "duration": ""},
    ],
    "doctor_notes": [],
    "patient": {"name": "", "age": "6 months", "sex": "F", "weight": "6.6"},
    "raw_text": "Age 6months Wt 6.6\nc/o cold, cough 2 days\nT-Minic drops 0.3ml TDS",
})


def test_structured_fields_become_segment_hints():
    """Each medicine must arrive as its own segment with fields kept apart.

    If dosage and frequency were folded into the text they would be re-parsed by
    regex — and, worse, a dosage line can itself match a drug name: "0-0-1 X 1
    week" once resolved to "x worm 400mg tablet".
    """
    result = parse_vision_json("gemini", REPLY)
    assert len(result.segments) == 2

    first = result.segments[0]
    assert first.medicine_hint == "Paracetamol"
    assert first.dosage_hint == "650mg"
    assert first.frequency_hint == "TDS"
    assert first.duration_hint == "3 days"
    assert first.confidence is None      # cloud providers report no per-line score


def test_hints_survive_the_medicine_line_gate():
    """The gate must judge the model's medicine name, not the joined text."""
    result = parse_vision_json("gemini", REPLY)
    for seg in result.segments:
        item, reason = _process_segment(seg)
        assert item is not None, f"gate dropped a VLM medicine: {seg.text!r} ({reason})"
        assert item.dosage, f"dosage lost for {seg.medicine_hint!r}"
        assert item.frequency, f"frequency lost for {seg.medicine_hint!r}"


def test_named_medicines_resolve_from_vlm_output():
    result = parse_vision_json("gemini", REPLY)
    named = [i.name for i in (_process_segment(s)[0] for s in result.segments) if i and i.name]
    assert len(named) == 2, f"expected both to resolve, got {named}"


def test_notes_and_raw_text_are_carried_through():
    result = parse_vision_json("gemini", REPLY)
    assert result.notes == ["Take after food"]
    assert "Paracetamol" in result.full_text


def test_markdown_fenced_reply_is_parsed():
    """Models often wrap JSON in ```json fences despite being told not to."""
    result = parse_vision_json("openai", f"```json\n{REPLY}\n```")
    assert len(result.segments) == 2


def test_prose_reply_degrades_to_lines_instead_of_crashing():
    """A non-JSON reply must not raise — it becomes plain text segments."""
    result = parse_vision_json("openai", "I cannot read this prescription.")
    assert result.segments and result.full_text


def test_empty_reply_is_safe():
    result = parse_vision_json("gemini", '{"medicines":[],"doctor_notes":[],"raw_text":""}')
    assert result.segments == []


# --------------------------------------------------------------------------
# Patient demographics (Phase 3): the "Age 6months / Wt 6.6" form line used to
# be dropped by the vision path entirely, so a 6-month-old on four medications
# reached clinical decision support with age=None and graded "risk: low".
# --------------------------------------------------------------------------
def test_patient_demographics_survive_parsing():
    result = parse_vision_json("gemini", INFANT_REPLY)
    assert result.patient == {"age": "6 months", "sex": "F", "weight": "6.6"}


# --------------------------------------------------------------------------
# Run-on transcriptions. A vision model returns the page as ONE paragraph with
# no newlines, but the regex field parser was written for line-structured OCR.
# Measured on a real hospital card: the `hospital` field held the entire 500-char
# transcription and the UI rendered it as the clinic's name.
# --------------------------------------------------------------------------
RUN_ON = (
    "DR. BABA SAHEB AMBEDKAR HOSPITAL, ROHINI. Date: July 18 2021. "
    "Name: LAXMI, Age: 52, Sex: Female. Complaints/History: C/o Pain in "
    "abdomen. Known case of T2DM / HTN. Examination: CVS, CNS, P.A, R/S WNL. "
    "Treatment/Instructions: Inj. Diclofenac 25mg IV Stat, Inj. Pantop IV "
    "Stat. Signature: Senior S.R."
)


def test_run_on_paragraph_does_not_swallow_the_page():
    f = parse_fields(RUN_ON)
    assert f["hospital"] == "BABA SAHEB AMBEDKAR HOSPITAL, ROHINI"
    for key, value in f.items():
        if isinstance(value, str):
            assert len(value) <= 200, f"{key} ran to {len(value)} chars: {value[:60]}..."


def test_hospital_named_after_a_person_is_not_a_doctor():
    """"Dr. Baba Saheb Ambedkar Hospital" is an institution, not a physician."""
    assert parse_fields(RUN_ON)["doctor"] is None
    assert parse_fields("Dr. R. Keshwani\nSunshine Hospital")["doctor"] == "R. Keshwani"


def test_run_on_labels_bound_each_value():
    f = parse_fields(RUN_ON)
    assert f["diagnosis"] == "C/o Pain in abdomen. Known case of T2DM / HTN"
    # Must reach the second injection — an over-eager bound cut it at "Inj".
    assert f["advice"] == "Inj. Diclofenac 25mg IV Stat, Inj. Pantop IV Stat"
    assert f["date"] == "July 18 2021"          # month-first was dropped entirely
    assert f["patient"] == "LAXMI" and f["age"] == "52" and f["gender"] == "Female"


def test_line_structured_text_still_parses():
    """The fallback must not regress for local-OCR output, which has newlines."""
    f = parse_fields(
        "Dr. R. Keshwani\nSunshine Hospital\nName: Prathna  Age: 34 yrs  Sex: F\n"
        "Date: 15-03-22\nC/o fever\nAdvice: rest and fluids"
    )
    assert f["doctor"] == "R. Keshwani"
    assert f["hospital"] == "Sunshine Hospital"
    assert f["patient"] == "Prathna"
    assert f["age"] == "34 yrs"
    assert f["diagnosis"] == "fever"
    assert f["advice"] == "rest and fluids"


def test_visit_fields_parse_and_merge():
    reply = json.loads(INFANT_REPLY)
    reply["visit"] = {
        "doctor": "D. Ravi Shankar", "hospital": "Preethi Child Clinic",
        "date": "22/11/19", "diagnosis": "cold, cough 2 days",
        "advice": "", "follow_up": "", "investigations": "",
    }
    result = parse_vision_json("gemini", json.dumps(reply))
    assert result.visit["doctor"] == "D. Ravi Shankar"
    assert "advice" not in result.visit          # empty string == not on page

    fields = PrescriptionFields(**parse_fields(result.full_text))
    _merge_vlm_fields(fields, result)
    assert fields.doctor == "D. Ravi Shankar"
    assert fields.hospital == "Preethi Child Clinic"
    assert fields.diagnosis == "cold, cough 2 days"
    assert fields.age == "6 months"              # patient merge still applies


def test_printed_ruled_lines_are_stripped_but_dosing_survives():
    """Form rules cost 17 CER points on an otherwise character-perfect page."""
    result = parse_vision_json("gemini", json.dumps({
        "medicines": [{"medicine": "T-Minic", "dosage": "", "frequency": "0.3ml-0.3ml-0.3ml", "duration": ""}],
        "doctor_notes": [],
        "raw_text": "Dr B. Who tel. 3876\n--------------------------\nR/ Digoxin 0.125 mg\nSig 1-0-1",
    }))
    assert "---" not in result.full_text
    assert "tel. 3876" in result.full_text
    assert "1-0-1" in result.full_text                    # dosing notation intact
    assert result.segments[0].frequency_hint == "0.3ml-0.3ml-0.3ml"


def test_vlm_visit_fields_are_capped():
    """A model that dumps the page into a field must not reach the UI card."""
    page = "X" * 3000
    result = parse_vision_json("gemini", json.dumps({
        "medicines": [], "doctor_notes": [], "raw_text": "x",
        "visit": {"hospital": page, "diagnosis": page},
    }))
    fields = PrescriptionFields()
    _merge_vlm_fields(fields, result)
    assert len(fields.hospital) == 200      # identity field: tight cap
    assert len(fields.diagnosis) == 1000    # prose: generous, real findings run long


def test_reply_without_patient_key_yields_empty_dict():
    """Older-style replies (and empty-string fields) must not fabricate a patient."""
    result = parse_vision_json("gemini", REPLY)
    assert result.patient == {}
    padded = json.loads(INFANT_REPLY)
    padded["patient"] = {"name": "", "age": "", "sex": "", "weight": ""}
    result = parse_vision_json("gemini", json.dumps(padded))
    assert result.patient == {}


def test_patient_merge_wins_over_regex_and_normalises():
    """VLM demographics overlay the regex guesses, units intact, sex normalised."""
    fields = PrescriptionFields(**parse_fields("Patient: Someone Else\nAge 6\n"))
    _merge_vlm_fields(fields, RawOCRResult(
        provider="gemini", full_text="",
        patient={"name": "Baby A", "age": "6 months", "sex": "F", "weight": "6.6 kg"},
    ))
    assert fields.patient == "Baby A"
    assert fields.age == "6 months"        # NOT "6" — the units are the point
    assert fields.gender == "Female"
    assert fields.vitals["weight"] == "6.6 kg"


def test_patient_merge_is_a_noop_for_plain_ocr():
    """Local engines report no VLM fields; regex-parsed values must be untouched."""
    fields = PrescriptionFields(**parse_fields("Patient: John Doe Age: 45 yrs"))
    before = fields.model_dump()
    _merge_vlm_fields(fields, RawOCRResult(provider="local", full_text=""))
    assert fields.model_dump() == before
    assert fields.age == "45 yrs"


def test_drops_is_not_a_doctor():
    """'T-Minic drops' once parsed as doctor='ops' ('dr' matched inside 'drops')."""
    assert parse_fields("T-Minic drops 0.3ml TDS")["doctor"] is None
    assert parse_fields("Dr. D. Ravi Shankar\nT-Minic drops")["doctor"] == "D. Ravi Shankar"


def test_doctor_name_stops_at_the_patient_title():
    """A VLM returns the header as one line; the patient must not glue on.

    Measured on 2.jpg: doctor read "R. Keshwani. Ms. Prathna".
    """
    f = parse_fields("Dr. R. Keshwani. Ms. Prathna. Date 15-03-22.")
    assert f["doctor"] == "R. Keshwani"
    assert f["date"] == "15-03-22"


def test_regex_age_capture_keeps_the_unit():
    """The regex fallback path must not strip 'months' either."""
    assert parse_fields("Age 6 months")["age"].lower() == "6 months"
    assert parse_fields("Age 6months")["age"].lower() == "6months"
    assert parse_fields("Age: 45")["age"] == "45"


def test_age_to_years_understands_units():
    """'6 months' must reach the clinical rules as an infant, not a 6-year-old."""
    assert age_to_years(None) is None
    assert age_to_years("") is None
    assert age_to_years("no digits") is None
    assert age_to_years(45) == 45
    assert age_to_years("45") == 45
    assert age_to_years("45 yrs") == 45
    assert age_to_years("45/M") == 45      # separated letter = sex marker
    assert age_to_years("6 months") == 0
    assert age_to_years("6months") == 0
    assert age_to_years("6m") == 0         # attached letter = pediatric shorthand
    assert age_to_years("18 months") == 1
    assert age_to_years("6/12") == 0       # clinical fraction notation
    assert age_to_years("3 wks") == 0
    assert age_to_years("10 days") == 0


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
