"""Provider interface + shared data structures.

Every OCR backend (Gemini, GPT-4o, Google Vision, local) implements
``OCRProvider`` and returns a ``RawOCRResult``. This is the seam that lets you
swap engines with one env var and never touch the pipeline.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class OCRSegment:
    """One logical line/region of the prescription.

    Vision-LLM providers can pre-parse fields (``*_hint``); plain OCR engines
    leave them None and the pipeline's field-extraction layer fills them in.
    """

    text: str
    confidence: float | None = None  # 0..1 if the engine reports one
    medicine_hint: str | None = None
    dosage_hint: str | None = None
    frequency_hint: str | None = None
    duration_hint: str | None = None


@dataclass
class RawOCRResult:
    provider: str
    full_text: str
    segments: list[OCRSegment] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


class OCRProvider:
    """Base class. Subclasses implement ``extract``."""

    name: str = "base"

    def extract(self, image_path: str) -> RawOCRResult:  # pragma: no cover
        raise NotImplementedError


# Shared prompt for vision-LLM providers. We ask for STRICT JSON so parsing is
# deterministic, and we deliberately do NOT ask the model to invent medicines:
# it transcribes, and our dictionary layer validates/corrects names afterwards.
VISION_PROMPT = """You are an expert at reading messy, handwritten medical \
prescriptions (including Indian doctor handwriting and brand names).

Transcribe the prescription as accurately as possible. For each prescribed \
item, extract these fields if present:
- medicine: the drug/brand name exactly as written (best guess if unclear)
- dosage: strength or amount (e.g. "650mg", "1 tab", "5ml", "1-0-1")
- frequency: how often (e.g. "OD", "BD", "TDS", "SOS", "HS", "1-0-1")
- duration: how long (e.g. "5 days", "1 week", "x7")

Also capture any free-text doctor notes/advice separately.

Return ONLY valid minified JSON, no markdown fences, in EXACTLY this shape:
{"medicines":[{"medicine":"","dosage":"","frequency":"","duration":""}],\
"doctor_notes":[""],"raw_text":""}

Rules:
- If a field is missing, use an empty string "".
- Do not fabricate medicines that are not on the page.
- "raw_text" is the full literal transcription of everything you can read.
- If you cannot read the image at all, return empty arrays and "raw_text":"".
"""
