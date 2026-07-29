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

from backend.ocr.pipeline import _process_segment
from backend.ocr.providers._json import parse_vision_json

REPLY = json.dumps({
    "medicines": [
        {"medicine": "Paracetamol", "dosage": "650mg", "frequency": "TDS", "duration": "3 days"},
        {"medicine": "Cetirizine", "dosage": "10mg", "frequency": "0-0-1", "duration": "1 week"},
    ],
    "doctor_notes": ["Take after food"],
    "raw_text": "Paracetamol 650mg TDS 3 days\nCetirizine 10mg 0-0-1 1 week",
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
