"""Orchestrates the 5-stage prescription pipeline.

preprocess -> recognize (provider) -> medicine intelligence -> field
extraction -> confidence + needs-review flags.
"""

from __future__ import annotations

from backend.config import settings
from backend.ocr import field_extraction as fe
from backend.ocr.medicine_intelligence import get_index
from backend.ocr.preprocess import prepare_for_deep_model
from backend.ocr.providers.base import OCRSegment, RawOCRResult
from backend.ocr.providers.factory import get_provider
from backend.ocr.schemas import (
    ExtractedMedicine,
    MedicineCandidate,
    MedicineDetails,
    PrescriptionResult,
)


def _looks_like_noise(text: str) -> bool:
    letters = [c for c in text if c.isalpha()]
    return len(letters) < 3


def _row_confidence(match_score: float, seg_conf: float | None) -> float:
    """Blend dictionary match score (0-100) with engine OCR confidence (0-1)."""
    dict_conf = match_score / 100.0
    if seg_conf is None:
        return round(dict_conf, 3)
    return round(0.7 * dict_conf + 0.3 * seg_conf, 3)


def _process_segment(seg: OCRSegment) -> ExtractedMedicine | None:
    index = get_index()

    # The query for medicine matching: the LLM's hint if present, else the line.
    query = (seg.medicine_hint or seg.text).strip()
    if _looks_like_noise(query):
        return None

    matches = index.search(query, limit=3)
    candidates = [MedicineCandidate(name=m.name, score=m.score) for m in matches]
    best = matches[0] if matches else None

    # Fields: prefer the LLM's structured hints, fall back to regex on the line.
    parsed = fe.extract_fields(seg.text)
    dosage = seg.dosage_hint or parsed["dosage"]
    freq_raw = seg.frequency_hint or parsed["frequency"]
    # Expand whatever frequency token we ended up with.
    _, freq_expanded = fe.extract_frequency(freq_raw or "")
    freq_expanded = freq_expanded or parsed["frequency_expanded"]
    duration = seg.duration_hint or parsed["duration"]

    match_score = best.score if best else 0.0
    confidence = _row_confidence(match_score, seg.confidence)
    needs_review = match_score < settings.MEDICINE_MATCH_THRESHOLD

    details = None
    name = None
    if best and not needs_review:
        name = best.name
        details = MedicineDetails(**index.details(best.name))

    return ExtractedMedicine(
        raw_text=seg.text,
        name=name,
        candidates=candidates,
        dosage=dosage or None,
        frequency=freq_raw or None,
        frequency_expanded=freq_expanded or None,
        duration=duration or None,
        confidence=confidence,
        needs_review=needs_review,
        details=details,
    )


def run_pipeline(image_path: str, provider_name: str | None = None) -> PrescriptionResult:
    # 1. Preprocess (engine-aware; deep models want natural images).
    processed = (
        prepare_for_deep_model(image_path, settings.UPLOAD_DIR)
        if settings.ENABLE_PREPROCESSING
        else image_path
    )

    # 2. Recognize.
    provider = get_provider(provider_name)
    raw: RawOCRResult = provider.extract(processed)

    # 3 + 4. Medicine intelligence + field extraction, per segment.
    medicines: list[ExtractedMedicine] = []
    for seg in raw.segments:
        item = _process_segment(seg)
        if item is not None:
            medicines.append(item)

    # De-duplicate by matched name (keep highest confidence).
    deduped: dict[str, ExtractedMedicine] = {}
    passthrough: list[ExtractedMedicine] = []
    for m in medicines:
        if m.name:
            if m.name not in deduped or m.confidence > deduped[m.name].confidence:
                deduped[m.name] = m
        else:
            passthrough.append(m)  # unmatched rows still shown for human review
    final = list(deduped.values()) + passthrough

    # 5. Confidence + warnings.
    confident = [m for m in final if not m.needs_review]
    overall = (
        round(sum(m.confidence for m in confident) / len(confident), 3)
        if confident
        else 0.0
    )

    warnings: list[str] = []
    if not final:
        warnings.append("No medicines could be read. Try a clearer photo.")
    if overall and overall < settings.MIN_CONFIDENCE:
        warnings.append(
            "Low overall confidence — please verify every item manually."
        )
    review_count = sum(1 for m in final if m.needs_review)
    if review_count:
        warnings.append(f"{review_count} item(s) need manual verification.")

    return PrescriptionResult(
        provider=raw.provider,
        medicines=final,
        doctor_notes=raw.notes,
        raw_text=raw.full_text,
        overall_confidence=overall,
        warnings=warnings,
    )
