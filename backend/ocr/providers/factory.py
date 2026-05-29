"""Provider factory: pick the best available OCR engine (cached).

Selection logic (no API key required):

* OCR_PROVIDER="auto" (default) -> Gemini **only if** GEMINI_API_KEY is set and
  the SDK is importable; otherwise the local EasyOCR/Tesseract engine.
* An explicit provider ("gemini"/"openai"/"google_vision"/"local") is honored,
  but if a cloud provider can't initialize (missing key/SDK/credentials) we
  fall back to the local engine instead of raising — so the API never returns
  "GEMINI_API_KEY is not set".
"""

from __future__ import annotations

from functools import lru_cache

from backend.config import settings
from backend.ocr.providers.base import OCRProvider

CLOUD_PROVIDERS = {"gemini", "openai", "google_vision"}


def _gemini_usable() -> bool:
    if not settings.GEMINI_API_KEY:
        return False
    try:
        import google.genai  # noqa: F401  (import name for the google-genai SDK)

        return True
    except Exception:  # noqa: BLE001
        return False


def resolve_provider_name(requested: str | None = None) -> str:
    """Resolve "auto"/None to a concrete engine name without instantiating it."""
    name = (requested or settings.OCR_PROVIDER or "auto").lower()
    if name == "auto":
        return "gemini" if _gemini_usable() else "local"
    return name


def _build(name: str) -> OCRProvider:
    if name == "gemini":
        from backend.ocr.providers.gemini_provider import GeminiProvider

        return GeminiProvider()
    if name == "openai":
        from backend.ocr.providers.openai_provider import OpenAIProvider

        return OpenAIProvider()
    if name == "google_vision":
        from backend.ocr.providers.google_vision_provider import GoogleVisionProvider

        return GoogleVisionProvider()
    if name == "local":
        from backend.ocr.providers.local_provider import LocalProvider

        return LocalProvider()
    raise ValueError(
        f"Unknown OCR provider '{name}'. "
        "Use one of: auto, gemini, openai, google_vision, local."
    )


@lru_cache(maxsize=8)
def get_provider(name: str | None = None) -> OCRProvider:
    """Return a cached provider instance, falling back to local on cloud failure."""
    resolved = resolve_provider_name(name)
    try:
        return _build(resolved)
    except Exception:  # noqa: BLE001 — missing key/SDK/credentials, etc.
        if resolved != "local":
            # Graceful degradation: use the offline engine instead of erroring.
            return _build("local")
        raise
