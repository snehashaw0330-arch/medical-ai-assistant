"""Medicine information lookup, backed by the shared MedicineIndex.

Reuses the same fuzzy/phonetic index as the OCR pipeline, so the dataset is
loaded once and matching behaviour is consistent across the app.
"""

from fastapi import APIRouter

from backend.ocr.medicine_intelligence import get_index

router = APIRouter(tags=["medicine"])


@router.get("/medicine-info/{medicine_name}")
def medicine_info(medicine_name: str):
    index = get_index()
    matches = index.search(medicine_name, limit=3)

    if not matches or matches[0].score < 60:
        return {"error": "Medicine not found", "suggestions": [m.name for m in matches]}

    best = matches[0]
    details = index.details(best.name)
    return {
        "medicine": details.get("name", best.name),
        "match_score": best.score,
        "uses": details.get("uses", []),
        "side_effects": details.get("side_effects", []),
        "substitutes": details.get("substitutes", []),
        "chemical_class": details.get("chemical_class", ""),
        "therapeutic_class": details.get("therapeutic_class", ""),
        "action_class": details.get("action_class", ""),
        "habit_forming": details.get("habit_forming", ""),
        "other_matches": [
            {"name": m.name, "score": m.score} for m in matches[1:]
        ],
    }
