"""FastAPI routes for the redesigned disease-prediction system."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from backend.disease.schemas import DiseaseResponse
from backend.disease.service import get_service

router = APIRouter(prefix="/disease", tags=["disease-prediction"])


class PredictRequest(BaseModel):
    symptoms: list[str] = Field(..., min_length=1, examples=[["high fever", "headache"]])
    top_k: int = Field(default=3, ge=1, le=5)


@router.post("/predict", response_model=DiseaseResponse)
def predict(req: PredictRequest) -> DiseaseResponse:
    try:
        return get_service().predict(req.symptoms, top_k=req.top_k)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.get("/symptoms")
def symptoms() -> dict:
    return {"symptoms": get_service().all_symptoms()}


@router.get("/symptoms/suggest")
def suggest(q: str = Query("", description="Partial symptom text"),
            limit: int = Query(8, ge=1, le=20)) -> dict:
    return {"suggestions": get_service().autocomplete(q, limit=limit)}


@router.get("/health")
def health() -> dict:
    svc = get_service()
    return {
        "base_model": svc.metadata,
        "n_symptoms": len(svc.features),
        "n_diseases": len(svc.classes),
    }
