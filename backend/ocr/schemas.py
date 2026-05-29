"""Pydantic response models for the OCR API (the frontend contract)."""

from __future__ import annotations

from pydantic import BaseModel


class MedicineCandidate(BaseModel):
    name: str
    score: float  # 0..100


class MedicineDetails(BaseModel):
    name: str = ""
    uses: list[str] = []
    side_effects: list[str] = []
    substitutes: list[str] = []
    chemical_class: str = ""
    therapeutic_class: str = ""
    action_class: str = ""
    habit_forming: str = ""


class ExtractedMedicine(BaseModel):
    raw_text: str
    name: str | None = None              # best matched display name
    candidates: list[MedicineCandidate] = []   # top 3
    dosage: str | None = None
    frequency: str | None = None
    frequency_expanded: str | None = None
    duration: str | None = None
    confidence: float                    # 0..1 for this row
    needs_review: bool                   # true => UI should ask a human
    details: MedicineDetails | None = None


class PrescriptionResult(BaseModel):
    provider: str
    medicines: list[ExtractedMedicine] = []
    doctor_notes: list[str] = []
    raw_text: str = ""
    overall_confidence: float = 0.0      # 0..1
    warnings: list[str] = []
