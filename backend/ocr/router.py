"""FastAPI routes for the redesigned prescription OCR system."""

from __future__ import annotations

import shutil
import uuid
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Query, UploadFile

from backend.config import settings
from backend.ocr.pipeline import run_pipeline
from backend.ocr.providers.factory import resolve_provider_name
from backend.ocr.schemas import PrescriptionResult

router = APIRouter(prefix="/ocr", tags=["prescription-ocr"])

_ALLOWED = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff"}


@router.get("/health")
def ocr_health() -> dict:
    """Report which engine will actually be used (after auto-resolution)."""
    active = resolve_provider_name()
    return {
        "configured": settings.OCR_PROVIDER,
        "active_provider": active,
        "is_local": active == "local",
        "preprocessing": settings.ENABLE_PREPROCESSING,
        "match_threshold": settings.MEDICINE_MATCH_THRESHOLD,
    }


@router.post("/extract-prescription", response_model=PrescriptionResult)
async def extract_prescription(
    file: UploadFile = File(...),
    provider: str | None = Query(
        default=None,
        description="Override OCR engine: gemini | openai | google_vision | local",
    ),
) -> PrescriptionResult:
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in _ALLOWED:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{suffix}'. Allowed: {sorted(_ALLOWED)}",
        )

    # Save to a unique path so concurrent uploads never collide.
    dest = Path(settings.UPLOAD_DIR) / f"{uuid.uuid4().hex}{suffix}"
    try:
        with open(dest, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    finally:
        await file.close()

    try:
        return run_pipeline(str(dest), provider_name=provider)
    except RuntimeError as exc:
        # Misconfiguration (missing key / SDK) -> actionable 503.
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"OCR failed: {exc}") from exc
    finally:
        dest.unlink(missing_ok=True)  # don't retain medical images on disk
