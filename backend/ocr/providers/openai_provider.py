"""OpenAI GPT-4o vision provider (alternative to Gemini).

Install: ``pip install openai`` and set ``OPENAI_API_KEY``.
"""

from __future__ import annotations

import base64

from backend.config import settings
from backend.ocr.providers.base import VISION_PROMPT, OCRProvider, RawOCRResult
from backend.ocr.providers._json import parse_vision_json


class OpenAIProvider(OCRProvider):
    name = "openai"

    def __init__(self) -> None:
        if not settings.OPENAI_API_KEY:
            raise RuntimeError("OPENAI_API_KEY is not set.")
        try:
            from openai import OpenAI  # type: ignore
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError(
                "openai is not installed. Run: pip install openai"
            ) from exc
        self._client = OpenAI(api_key=settings.OPENAI_API_KEY)
        self._model = settings.OPENAI_MODEL

    def extract(self, image_path: str) -> RawOCRResult:
        with open(image_path, "rb") as f:
            b64 = base64.b64encode(f.read()).decode()
        mime = "image/png" if image_path.lower().endswith(".png") else "image/jpeg"

        resp = self._client.chat.completions.create(
            model=self._model,
            temperature=0.0,
            response_format={"type": "json_object"},
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": VISION_PROMPT},
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:{mime};base64,{b64}"},
                        },
                    ],
                }
            ],
        )
        text = resp.choices[0].message.content or ""
        return parse_vision_json(self.name, text)
