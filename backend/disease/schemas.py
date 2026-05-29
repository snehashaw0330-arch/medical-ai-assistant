"""Response schemas for the disease-prediction API (frontend contract)."""

from __future__ import annotations

from pydantic import BaseModel


class SymptomResolution(BaseModel):
    input: str
    matched: str | None
    score: float
    method: str  # exact | alias | fuzzy | none


class DiseasePrediction(BaseModel):
    disease: str
    confidence: float                 # 0..100, calibrated
    matched_symptoms: list[str]       # of the user's symptoms, those typical here
    explanation: str                  # human-readable "why"


class SuggestedSymptom(BaseModel):
    symptom: str
    discriminative_score: float       # how much it would help confirm top disease


class DiseaseResponse(BaseModel):
    predictions: list[DiseasePrediction]
    resolved_symptoms: list[SymptomResolution]
    unmatched_inputs: list[str]
    suggested_symptoms: list[SuggestedSymptom]
    confidence_level: str             # high | moderate | low
    warnings: list[str]
    disclaimer: str
