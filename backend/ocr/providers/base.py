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
    # Patient demographics as transcribed by a vision-LLM ("name"/"age"/"sex"/
    # "weight", values verbatim strings, e.g. age "6 months"). Plain OCR engines
    # leave this empty and the regex field parser works from full_text instead.
    # Kept verbatim because the units matter downstream: an age of "6 months"
    # must reach the clinical rules as an infant, not as a 6-year-old.
    patient: dict[str, str] = field(default_factory=dict)
    # Visit header as transcribed by a vision-LLM. Keys match PrescriptionFields
    # 1:1 (doctor/hospital/date/diagnosis/advice/follow_up/investigations) so the
    # merge needs no mapping table. Empty for plain OCR engines.
    visit: dict[str, str] = field(default_factory=dict)


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

Also capture, separately: any free-text doctor notes/advice; the patient's \
demographics (name, age, sex, weight), often written as short form entries \
like "Age 6months", "Wt 6.6", "M/F"; and the visit header (prescriber, \
institution, date, complaints/diagnosis, treatment advice, follow-up, \
investigations ordered).

Return ONLY valid minified JSON, no markdown fences, in EXACTLY this shape:
{"medicines":[{"medicine":"","dosage":"","frequency":"","duration":""}],\
"doctor_notes":[""],"patient":{"name":"","age":"","sex":"","weight":""},\
"visit":{"doctor":"","hospital":"","date":"","diagnosis":"","advice":"",\
"follow_up":"","investigations":""},"raw_text":""}

Rules:
- If a field is missing, use an empty string "".
- Do not fabricate medicines that are not on the page.
- Patient fields are transcribed verbatim, units included: age "6 months" \
must stay "6 months" (never convert to a bare number), weight "6.6" or \
"6.6 kg" as written. Never guess demographics that are not on the page.
- "doctor" is the PERSON who wrote or signed the prescription, without the \
"Dr." title. "hospital" is the institution. Many Indian hospitals are NAMED \
after a person and so begin with "Dr." (e.g. "Dr. Baba Saheb Ambedkar \
Hospital") — that is the hospital, not the doctor. When the page names no \
individual physician, leave "doctor" empty rather than reusing the institution.
- Keep each visit field to what the page states for THAT field; never let one \
field absorb the rest of the page.
- "raw_text" is the full literal transcription of everything you can read, \
including the demographics lines. Preserve the page's line breaks as "\\n" \
— do not flatten the page into a single paragraph.
- If you cannot read the image at all, return empty arrays and "raw_text":"".
"""
