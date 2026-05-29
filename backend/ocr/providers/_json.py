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
    raw_text = (data.get("raw_text") or "").strip()
    if not raw_text:
        raw_text = "\n".join(s.text for s in segments)

    return RawOCRResult(
        provider=provider, full_text=raw_text, segments=segments, notes=notes
    )
