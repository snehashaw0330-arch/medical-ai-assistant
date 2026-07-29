"""Orchestrates the prescription OCR pipeline.

preprocess -> recognize -> medicine intelligence -> field extraction ->
structured parsing -> confidence + needs-review flags.

Recognition uses a cloud vision provider when one is configured (auto), and
otherwise the local **multi-engine ensemble** (EasyOCR / PaddleOCR / DocTR /
TrOCR / Tesseract) which scores candidates and picks the best.
"""

from __future__ import annotations

import logging
import re

from backend.config import settings
from backend.ocr import field_extraction as fe
from backend.ocr import parser as rx_parser
from backend.ocr.engines.ensemble import run_ensemble
from backend.ocr.line_filter import is_medicine_line
from backend.ocr.medicine_intelligence import get_index
from backend.ocr.preprocess import prepare_for_deep_model
from backend.ocr.providers.base import OCRSegment, RawOCRResult
from backend.ocr.providers.factory import get_provider, resolve_provider_name
from backend.ocr.schemas import (
    ExtractedMedicine,
    MedicineCandidate,
    MedicineDetails,
    PrescriptionFields,
    PrescriptionResult,
)


logger = logging.getLogger("ocr.pipeline")

#: A dosage form named on the line. Together with a strength, frequency or
#: duration this is the corroborating evidence that separates a real (if
#: misspelt) drug line from a stray fragment that merely resembles a brand name.
_FORM_WORD_RE = re.compile(
    r"\b(tab|tabs|tablet|tablets|cap|caps|capsule|capsules|syrup|susp|suspension|"
    r"drop|drops|cream|gel|ointment|lotion|inj|injection|solution|spray|inhaler|"
    r"sachet|powder|patch|suppository|eye drops|nasal drops)\b",
    re.IGNORECASE,
)


def _row_confidence(match_score: float, seg_conf: float | None) -> float:
    dict_conf = match_score / 100.0
    if seg_conf is None:
        return round(dict_conf, 3)
    return round(0.7 * dict_conf + 0.3 * seg_conf, 3)


def _process_segment(seg: OCRSegment) -> tuple[ExtractedMedicine | None, str]:
    """Turn one OCR line into a medicine row.

    Returns ``(row, skip_reason)``. When the line is not a prescribed item the
    row is ``None`` and ``skip_reason`` says why, so the caller can tell the
    user how many lines were excluded instead of silently shrinking the list.
    """
    index = get_index()
    query = (seg.medicine_hint or seg.text).strip()

    # Gate 1 — is this a medicine line at all? Letterhead, form labels, clock
    # times and lines the engine barely read are dropped outright: they are not
    # prescribed items, so there is nothing for a clinician to review.
    ok, reason = is_medicine_line(query, seg.confidence)
    if not ok:
        logger.debug("Skipping non-medicine line %r (%s)", query[:60], reason)
        return None, reason

    matches = index.search(query, limit=3)
    candidates = [MedicineCandidate(name=m.name, score=m.score) for m in matches]
    best = matches[0] if matches else None

    parsed = fe.extract_fields(seg.text)
    dosage = seg.dosage_hint or parsed["dosage"]
    freq_raw = seg.frequency_hint or parsed["frequency"]
    _, freq_expanded = fe.extract_frequency(freq_raw or "")
    freq_expanded = freq_expanded or parsed["frequency_expanded"]
    duration = seg.duration_hint or parsed["duration"]

    match_score = best.score if best else 0.0
    confidence = _row_confidence(match_score, seg.confidence)

    # Gate 2 — is the match trustworthy? The ranking score alone is not enough:
    # WRatio rewards substring hits, so noise routinely clears the threshold.
    # A match must also agree at whole-word level (see confirm_score).
    #
    # That agreement is judged on a sliding scale, because a single cutoff
    # provably cannot work: "Arthakind drops" -> "asthakind tablet" (a real drug
    # with one character misread) and the prose fragment "needb" -> "need syrup"
    # both score 88.9. What separates them is not the name — it is that a real
    # prescription line also states a dose, a frequency, a duration or a form.
    # So an unambiguous name match stands alone; a merely plausible one has to be
    # corroborated by that structure.
    #
    # Failing this does NOT discard the row — the line still looks like a
    # medicine, so it is surfaced with its candidates and flagged for manual
    # review rather than presented as a confidently identified drug.
    has_structure = bool(dosage or freq_raw or duration or _FORM_WORD_RE.search(seg.text))
    confirmed = bool(best) and (
        best.confirm >= settings.MEDICINE_CONFIRM_STRONG
        or (best.confirm >= settings.MEDICINE_CONFIRM_THRESHOLD and has_structure)
    )
    needs_review = match_score < settings.MEDICINE_MATCH_THRESHOLD or not confirmed

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
    ), ""


def _recognize(image_path: str, provider_name: str | None):
    """Return (RawOCRResult, engine_table, best_engine_name)."""
    resolved = resolve_provider_name(provider_name)
    # Cloud providers (when a key is configured) — single best engine.
    if resolved in {"gemini", "openai", "google_vision"}:
        try:
            provider = get_provider(provider_name)
            return provider.extract(image_path), {}, provider.name
        except Exception as exc:  # noqa: BLE001 — degrade to the local ensemble
            # Loudly. Falling back silently meant a benchmark run tagged
            # "gemini" could be pure local-ensemble output — an expired key or a
            # 429 produced numbers indistinguishable from a successful run, and
            # the quota error that caused it was never seen. The caller can tell
            # what actually ran from the returned provider name.
            logger.warning(
                "Cloud provider %r failed (%s: %s) — falling back to the local "
                "ensemble. Results are LOCAL, not %s.",
                resolved, type(exc).__name__, str(exc)[:200], resolved,
            )

    # Local multi-engine ensemble.
    index = get_index()
    best, table = run_ensemble(image_path, index)
    raw = RawOCRResult(
        provider=f"ensemble:{best.engine}",
        full_text=best.text,
        segments=[OCRSegment(text=l.text, confidence=l.confidence) for l in best.lines],
    )
    return raw, table, best.engine


def _preprocess_and_recognize(image_path: str, provider_name: str | None, preprocess: bool):
    """Preprocess + recognize (steps 1-2). Returns (RawOCRResult, engine_table, best_engine)."""
    processed = (
        prepare_for_deep_model(image_path, settings.UPLOAD_DIR)
        if preprocess and settings.ENABLE_PREPROCESSING
        else image_path
    )
    return _recognize(processed, provider_name)


def extract_raw_text(
    image_path: str,
    provider_name: str | None = None,
    preprocess: bool = True,
) -> tuple[str, dict, str]:
    """Preprocess + recognize only, without medicine-specific matching.

    Returns ``(full_text, engine_table, best_engine)``. Reuses the same
    preprocess/recognize step ``run_pipeline`` calls internally, so other
    modules (e.g. ``document_intelligence``) can reuse OCR text recognition
    without depending on medicine matching.
    """
    raw, engine_table, best_engine = _preprocess_and_recognize(
        image_path, provider_name, preprocess
    )
    return raw.full_text, engine_table, best_engine


def run_pipeline(
    image_path: str,
    provider_name: str | None = None,
    preprocess: bool = True,
) -> PrescriptionResult:
    # 1 + 2. Preprocess (callers that already cleaned the image, e.g. the
    # dataset evaluator, pass preprocess=False to avoid doing it twice) then
    # recognize (cloud provider or local ensemble).
    raw, engine_table, best_engine = _preprocess_and_recognize(
        image_path, provider_name, preprocess
    )

    # 3 + 4. Medicine intelligence + field extraction per line.
    medicines: list[ExtractedMedicine] = []
    unreadable = 0          # lines the OCR engine could not read well enough
    non_medicine = 0        # letterhead / form / contact lines
    for seg in raw.segments:
        item, skip_reason = _process_segment(seg)
        if item is not None:
            medicines.append(item)
        elif skip_reason.startswith("OCR confidence"):
            unreadable += 1
        else:
            non_medicine += 1

    deduped: dict[str, ExtractedMedicine] = {}
    passthrough: list[ExtractedMedicine] = []
    for m in medicines:
        if m.name:
            if m.name not in deduped or m.confidence > deduped[m.name].confidence:
                deduped[m.name] = m
        else:
            passthrough.append(m)
    final = list(deduped.values()) + passthrough

    # 5. Structured fields (doctor/patient/vitals/...).
    fields = PrescriptionFields(**rx_parser.parse_fields(raw.full_text))

    # 6. Confidence + warnings.
    confident = [m for m in final if not m.needs_review]
    overall = (
        round(sum(m.confidence for m in confident) / len(confident), 3)
        if confident else 0.0
    )
    warnings: list[str] = []
    if not final:
        warnings.append("No medicines could be read. Try a clearer photo.")
    if overall and overall < settings.MIN_CONFIDENCE:
        warnings.append("Low overall confidence — please verify every item manually.")
    review_count = sum(1 for m in final if m.needs_review)
    if review_count:
        warnings.append(f"{review_count} item(s) need manual verification.")
    # Be explicit about what was left out. Silently shrinking the list would
    # hide that the photo was partly unreadable, which is exactly when a
    # clinician most needs to go back to the paper prescription.
    if unreadable:
        warnings.append(
            f"{unreadable} line(s) were too unclear to read and were excluded — "
            "check the prescription for items missing from this list."
        )
    # Lines dropped as letterhead, dosage fragments or form labels are expected
    # on every prescription and are only logged, not surfaced: reporting them
    # would bury the warning above, which is the one that matters.
    if non_medicine:
        logger.debug("Skipped %d non-medicine line(s)", non_medicine)

    return PrescriptionResult(
        provider=raw.provider,
        medicines=final,
        fields=fields,
        doctor_notes=raw.notes,
        raw_text=raw.full_text,
        overall_confidence=overall,
        warnings=warnings,
        engines=engine_table,
        best_engine=best_engine,
    )
