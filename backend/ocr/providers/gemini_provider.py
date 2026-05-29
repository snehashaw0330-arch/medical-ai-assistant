"""Gemini vision provider (primary recommendation).

Uses the unified ``google-genai`` SDK. Install: ``pip install google-genai``
and set ``GEMINI_API_KEY``. The heavy import is lazy so the rest of the app
loads even if the SDK isn't installed.
"""

from __future__ import annotations

from backend.config import settings
from backend.ocr.providers.base import VISION_PROMPT, OCRProvider, RawOCRResult
from backend.ocr.providers._json import parse_vision_json


class GeminiProvider(OCRProvider):
    name = "gemini"

    def __init__(self) -> None:
        if not settings.GEMINI_API_KEY:
            raise RuntimeError(
                "GEMINI_API_KEY is not set. Add it to your environment/.env."
            )
        try:
            from google import genai  # type: ignore
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError(
                "google-genai is not installed. Run: pip install google-genai"
            ) from exc
        self._genai = genai
        self._client = genai.Client(api_key=settings.GEMINI_API_KEY)
        self._model = settings.GEMINI_MODEL

    def extract(self, image_path: str) -> RawOCRResult:
        with open(image_path, "rb") as f:
            image_bytes = f.read()

        # Best-effort mime detection; Gemini is tolerant.
        mime = "image/png" if image_path.lower().endswith(".png") else "image/jpeg"

        part = self._genai.types.Part.from_bytes(data=image_bytes, mime_type=mime)
        response = self._client.models.generate_content(
            model=self._model,
            contents=[VISION_PROMPT, part],
            config=self._genai.types.GenerateContentConfig(
                temperature=0.0,
                response_mime_type="application/json",
            ),
        )
        text = response.text or ""
        return parse_vision_json(self.name, text)
