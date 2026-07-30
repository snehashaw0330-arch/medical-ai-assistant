"""Shared helper: turn a vision-LLM's JSON reply into a RawOCRResult."""

from __future__ import annotations

import json
import re

from backend.ocr.providers.base import OCRSegment, RawOCRResult


def parse_vision_json(provider: str, text: str) -> RawOCRResult:
    """Robustly parse the model's JSON, tolerating stray markdown fences."""
    cleaned = text.strip()
    # Strip ```json ... ``` fences if the model added them.
    cleaned = re.sub(r"^```(?:json)?", "", cleaned).strip()
    cleaned = re.sub(r"```$", "", cleaned).strip()
    # Fallback: grab the outermost {...} if there's leading/trailing prose.
    if not cleaned.startswith("{"):
        m = re.search(r"\{.*\}", cleaned, re.DOTALL)
        if m:
            cleaned = m.group(0)

    try:
        data = json.loads(cleaned)
    except Exception:  # noqa: BLE001
        # Model didn't return JSON; treat whole reply as raw text.
        return RawOCRResult(
            provider=provider,
            full_text=text.strip(),
            segments=[OCRSegment(text=line) for line in text.splitlines() if line.strip()],
        )

    segments: list[OCRSegment] = []
    for item in data.get("medicines", []) or []:
        if not isinstance(item, dict):
            continue
        med = (item.get("medicine") or "").strip()
        dosage = (item.get("dosage") or "").strip()
        freq = (item.get("frequency") or "").strip()
        dur = (item.get("duration") or "").strip()
        text_line = " ".join(p for p in [med, dosage, freq, dur] if p)
        if not text_line:
            continue
        segments.append(
            OCRSegment(
                text=text_line,
                confidence=None,
                medicine_hint=med or None,
                dosage_hint=dosage or None,
                frequency_hint=freq or None,
                duration_hint=dur or None,
            )
        )

    notes = [n.strip() for n in (data.get("doctor_notes") or []) if str(n).strip()]
    raw_text = _strip_rules((data.get("raw_text") or "").strip())
    if not raw_text:
        raw_text = "\n".join(s.text for s in segments)

    # Patient demographics + visit header, verbatim. Only known keys, only
    # non-empty strings — the model is told never to guess, so an empty string
    # means "not on the page".
    patient = _string_map(data.get("patient"), ("name", "age", "sex", "weight"))
    visit = _string_map(
        data.get("visit"),
        ("doctor", "hospital", "date", "diagnosis", "advice", "follow_up",
         "investigations"),
    )

    return RawOCRResult(
        provider=provider, full_text=raw_text, segments=segments, notes=notes,
        patient=patient, visit=visit,
    )


#: A printed ruled line on a form ("--------"). Three or more, so dosing
#: notation ("1-0-1", "0.3ml-0.3ml") is never touched.
_RULE_RE = re.compile(r"[-_=]{3,}")


def _strip_rules(text: str) -> str:
    """Drop the form's printed ruled lines from a transcription.

    Asking the model to preserve line structure made it transcribe the ruled
    lines on pre-printed forms as runs of dashes. They are page furniture, not
    clinical content, and they cost 17 points of CER on an otherwise
    character-perfect page.
    """
    if not text:
        return text
    text = _RULE_RE.sub(" ", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    return "\n".join(line.strip() for line in text.split("\n")).strip()


def _string_map(obj: object, keys: tuple[str, ...]) -> dict[str, str]:
    """Pull ``keys`` off a model-supplied object as stripped, non-empty strings."""
    if not isinstance(obj, dict):
        return {}
    out: dict[str, str] = {}
    for key in keys:
        value = str(obj.get(key) or "").strip()
        if value:
            out[key] = value
    return out
