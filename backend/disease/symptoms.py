"""Symptom normalization, aliasing, and fuzzy matching.

The dataset uses snake_case canonical symptom names (e.g. ``high_fever``,
``runny_nose``). Real users type free text ("running nose", "throwing up",
"loose motion", "feverish"). This module bridges that gap with three layers:

1. Normalization        -> lowercase, collapse separators
2. Alias dictionary     -> curated synonyms / lay terms -> canonical
3. Fuzzy fallback       -> rapidfuzz match against canonical names

It returns *which* canonical symptom each input mapped to and the confidence,
so the API can be transparent about what it understood.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from rapidfuzz import fuzz, process

# Curated lay-term / spelling-variant -> canonical symptom name.
# Extend this freely; it is the cheapest accuracy win for real users.
ALIASES: dict[str, str] = {
    "fever": "high_fever",
    "feverish": "high_fever",
    "temperature": "high_fever",
    "mild fever": "mild_fever",
    "running nose": "runny_nose",
    "runny nose": "runny_nose",
    "blocked nose": "congestion",
    "stuffy nose": "congestion",
    "throwing up": "vomiting",
    "throw up": "vomiting",
    "puking": "vomiting",
    "loose motion": "diarrhoea",
    "loose motions": "diarrhoea",
    "loose stool": "diarrhoea",
    "diarrhea": "diarrhoea",
    "stomach ache": "stomach_pain",
    "tummy pain": "stomach_pain",
    "belly pain": "abdominal_pain",
    "head ache": "headache",
    "head pain": "headache",
    "tiredness": "fatigue",
    "tired": "fatigue",
    "exhausted": "fatigue",
    "weakness": "fatigue",
    "short of breath": "breathlessness",
    "shortness of breath": "breathlessness",
    "difficulty breathing": "breathlessness",
    "itchy": "itching",
    "itchiness": "itching",
    "rash": "skin_rash",
    "skin rash": "skin_rash",
    "joint ache": "joint_pain",
    "body ache": "muscle_pain",
    "body pain": "muscle_pain",
    "chills": "chills",
    "shivering": "shivering",
    "cold": "chills",
    "cough": "cough",
    "dry cough": "cough",
    "sore throat": "patches_in_throat",
    "yellow eyes": "yellowing_of_eyes",
    "yellow skin": "yellowish_skin",
    "frequent urination": "polyuria",
    "burning urination": "burning_micturition",
    "painful urination": "burning_micturition",
    "high sugar": "irregular_sugar_level",
    "dizzy": "dizziness",
    "dizziness": "dizziness",
    "vomit": "vomiting",
    "nausea": "nausea",
    "constipated": "constipation",
}


def normalize(text: str) -> str:
    s = text.strip().lower()
    s = re.sub(r"[_\-]+", " ", s)
    s = re.sub(r"\s+", " ", s)
    return s


def to_canonical_key(canonical: str) -> str:
    """Human label -> canonical snake_case (the dataset's column form)."""
    return re.sub(r"\s+", "_", normalize(canonical))


def humanize(canonical: str) -> str:
    return canonical.replace("_", " ").strip()


@dataclass
class SymptomMatch:
    input: str
    matched: str | None        # canonical name or None
    score: float               # 0..100
    method: str                # "exact" | "alias" | "fuzzy" | "none"


class SymptomMatcher:
    """Maps free-text symptoms to the model's canonical feature names."""

    def __init__(self, canonical_symptoms: list[str], fuzzy_cutoff: float = 82.0):
        self.canonical = list(canonical_symptoms)
        self._normalized = {normalize(humanize(c)): c for c in self.canonical}
        self._choices = list(self._normalized.keys())
        self.cutoff = fuzzy_cutoff

    def match_one(self, raw: str) -> SymptomMatch:
        norm = normalize(raw)
        if not norm:
            return SymptomMatch(raw, None, 0.0, "none")

        # 1. exact (after normalization)
        if norm in self._normalized:
            return SymptomMatch(raw, self._normalized[norm], 100.0, "exact")

        # 2. alias table
        if norm in ALIASES:
            canon = ALIASES[norm]
            if canon in self.canonical:
                return SymptomMatch(raw, canon, 100.0, "alias")

        # 3. fuzzy fallback against canonical names
        hit = process.extractOne(norm, self._choices, scorer=fuzz.WRatio)
        if hit and hit[1] >= self.cutoff:
            return SymptomMatch(raw, self._normalized[hit[0]], float(hit[1]), "fuzzy")

        return SymptomMatch(raw, None, hit[1] if hit else 0.0, "none")

    def match_many(self, raws: list[str]) -> list[SymptomMatch]:
        return [self.match_one(r) for r in raws]

    def suggest(self, partial: str, limit: int = 8) -> list[str]:
        """Autocomplete: canonical labels ranked by similarity to ``partial``."""
        norm = normalize(partial)
        if not norm:
            return [humanize(c) for c in self.canonical[:limit]]
        hits = process.extract(norm, self._choices, scorer=fuzz.WRatio, limit=limit)
        return [humanize(self._normalized[h[0]]) for h in hits]
