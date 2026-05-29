"""Local, offline OCR provider: EasyOCR (primary) + Tesseract (fallback).

Requires no API key. EasyOCR gives word/line boxes with confidences and is the
primary engine; if EasyOCR isn't installed (or reads nothing), we fall back to
Tesseract via ``pytesseract``. At least one of the two must be installed.

Heavy imports are lazy and the engine is built once (the factory caches the
provider instance), so model loading happens on the first OCR request, not at
server startup.
"""

from __future__ import annotations

from backend.ocr.providers.base import OCRProvider, OCRSegment, RawOCRResult


class LocalProvider(OCRProvider):
    name = "local"

    def __init__(self) -> None:
        self._reader = None          # EasyOCR reader (if available)
        self._has_tesseract = False  # pytesseract importable?

        try:
            import easyocr  # type: ignore

            # English; CPU by default. First run downloads the detection/
            # recognition models (~100MB) and caches them.
            self._reader = easyocr.Reader(["en"], gpu=False, verbose=False)
        except Exception:  # noqa: BLE001 — torch/easyocr not installed
            self._reader = None

        try:
            import pytesseract  # type: ignore  # noqa: F401

            self._has_tesseract = True
        except Exception:  # noqa: BLE001
            self._has_tesseract = False

        if self._reader is None and not self._has_tesseract:
            raise RuntimeError(
                "No local OCR engine available. Install one of:\n"
                "  pip install easyocr          (recommended)\n"
                "  pip install pytesseract       (also install the Tesseract binary)"
            )

    # ------------------------------------------------------------------
    def _easyocr_extract(self, image_path: str) -> list[OCRSegment]:
        # detail=1 (default) -> list of (bbox, text, confidence)
        results = self._reader.readtext(image_path)
        segments: list[OCRSegment] = []
        for item in results:
            text = (item[1] or "").strip()
            conf = float(item[2]) if len(item) > 2 else None
            if text:
                segments.append(OCRSegment(text=text, confidence=conf))
        return segments

    def _tesseract_extract(self, image_path: str) -> list[OCRSegment]:
        import pytesseract  # type: ignore
        from PIL import Image

        text = pytesseract.image_to_string(Image.open(image_path))
        return [OCRSegment(text=ln.strip()) for ln in text.splitlines() if ln.strip()]

    # ------------------------------------------------------------------
    def extract(self, image_path: str) -> RawOCRResult:
        segments: list[OCRSegment] = []

        # 1) EasyOCR primary
        if self._reader is not None:
            try:
                segments = self._easyocr_extract(image_path)
            except Exception:  # noqa: BLE001
                segments = []

        # 2) Tesseract fallback (also used if EasyOCR found nothing)
        if not segments and self._has_tesseract:
            try:
                segments = self._tesseract_extract(image_path)
            except Exception:  # noqa: BLE001
                segments = []

        full_text = "\n".join(s.text for s in segments)
        return RawOCRResult(provider=self.name, full_text=full_text, segments=segments)
