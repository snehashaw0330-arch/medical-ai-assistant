"""Disease prediction service: calibrated top-3 with explainability.

Loads the bundle produced by ``disease-prediction/train_model.py`` and turns a
list of free-text symptoms into ranked, explained predictions. Key features the
naive endpoint lacked:

* fuzzy + alias symptom matching (via SymptomMatcher)
* calibrated confidence scores
* per-prediction explanation (which reported symptoms are typical for it)
* "ask about these" suggested symptoms to disambiguate
* honest confidence_level + warnings (this is a triage aid, not a diagnosis)
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import joblib
import numpy as np

from backend.config import ROOT_DIR
from backend.disease.schemas import (
    DiseasePrediction,
    DiseaseResponse,
    SuggestedSymptom,
    SymptomResolution,
)
from backend.disease.symptoms import SymptomMatcher, humanize

BUNDLE_PATH = Path(ROOT_DIR) / "disease-prediction" / "models" / "disease_bundle.pkl"

DISCLAIMER = (
    "This is an AI triage aid, not a medical diagnosis. Always consult a "
    "qualified doctor."
)

# Below either of these the service returns no ranked predictions at all.
# See the refusal branch in `predict` for why there are two.
MIN_SYMPTOMS = 2
MIN_TOP_PROBABILITY = 0.15


class DiseaseService:
    def __init__(self, bundle_path: Path = BUNDLE_PATH):
        if not bundle_path.exists():
            raise RuntimeError(
                f"Model bundle not found at {bundle_path}. "
                "Run: python disease-prediction/train_model.py"
            )
        bundle = joblib.load(bundle_path)
        self.model = bundle["model"]
        self.classes: list[str] = bundle["classes"]
        self.features: list[str] = bundle["feature_names"]
        self.cooccurrence: np.ndarray = bundle["cooccurrence"]   # n_class x n_feat
        self.prevalence: np.ndarray = bundle["prevalence"]       # n_feat
        self._feat_idx = {f: i for i, f in enumerate(self.features)}
        self.matcher = SymptomMatcher(self.features)
        self.metadata = bundle.get("metadata", {})

    # -- helpers -----------------------------------------------------------
    def _vector(self, canonical: list[str]) -> np.ndarray:
        v = np.zeros(len(self.features), dtype=int)
        for c in canonical:
            i = self._feat_idx.get(c)
            if i is not None:
                v[i] = 1
        return v

    def _explain(self, disease_idx: int, reported: list[str]) -> tuple[list[str], str]:
        """Which reported symptoms are characteristic of this disease."""
        scored = [
            (s, self.cooccurrence[disease_idx, self._feat_idx[s]])
            for s in reported
            if s in self._feat_idx
        ]
        scored.sort(key=lambda x: x[1], reverse=True)
        typical = [humanize(s) for s, p in scored if p >= 0.5]
        name = self.classes[disease_idx]
        if typical:
            # Phrased as overlap, not inference. The previous wording — "Your
            # reported high fever is commonly seen in AIDS" — asserted a
            # clinical relationship the model never established; it is only
            # reporting which of the reported symptoms co-occur with the label
            # in the training data.
            text = (
                f"{name} lists {', '.join(typical[:4])} among its common symptoms. "
                "This is a symptom overlap, not a diagnosis."
            )
        else:
            text = f"Weak symptom overlap with {name}; treat this match cautiously."
        return typical, text

    def _suggest(self, disease_idx: int, reported: set[str], limit: int = 5
                 ) -> list[SuggestedSymptom]:
        """Unreported symptoms that would most help confirm the top disease.

        Discriminative score = P(symptom|disease) - P(symptom overall): high when
        a symptom is specific to this disease, not just generally common.
        """
        out: list[SuggestedSymptom] = []
        for i, feat in enumerate(self.features):
            if feat in reported:
                continue
            score = float(self.cooccurrence[disease_idx, i] - self.prevalence[i])
            if self.cooccurrence[disease_idx, i] >= 0.5 and score > 0:
                out.append(SuggestedSymptom(symptom=humanize(feat),
                                            discriminative_score=round(score, 3)))
        out.sort(key=lambda s: s.discriminative_score, reverse=True)
        return out[:limit]

    # -- main --------------------------------------------------------------
    def predict(self, symptoms: list[str], top_k: int = 3) -> DiseaseResponse:
        matches = self.matcher.match_many(symptoms)
        resolved = [
            SymptomResolution(input=m.input, matched=m.matched, score=round(m.score, 1),
                              method=m.method)
            for m in matches
        ]
        matched_canon = list({m.matched for m in matches if m.matched})
        unmatched = [m.input for m in matches if not m.matched]

        warnings: list[str] = []

        # Naming a condition is a different mistake from typing something
        # unrecognisable, and deserves a different answer. "None of the
        # symptoms were recognised" invites the user to rephrase "AIDS" until
        # something sticks — which is how they got an AIDS result in the first
        # place.
        conditions = [m.input for m in matches if m.method == "condition"]
        if conditions:
            warnings.append(
                f"{', '.join(conditions)} "
                f"{'is a condition' if len(conditions) == 1 else 'are conditions'}, "
                "not a symptom. Describe what you are feeling instead — "
                "this tool works out possible conditions from symptoms."
            )

        # A fuzzy match is a guess, so say so rather than silently substituting.
        guesses = [
            f"“{m.input}” as “{humanize(m.matched)}”"
            for m in matches
            if m.method == "fuzzy"
        ]
        if guesses:
            warnings.append(f"Interpreted {', '.join(guesses)}.")

        if not matched_canon:
            return DiseaseResponse(
                predictions=[], resolved_symptoms=resolved, unmatched_inputs=unmatched,
                suggested_symptoms=[], confidence_level="low",
                warnings=warnings or ["None of the symptoms were recognised. Try rephrasing."],
                disclaimer=DISCLAIMER,
            )
        proba = self.model.predict_proba([self._vector(matched_canon)])[0]
        order = proba.argsort()[::-1][:top_k]
        top = float(proba[order[0]])

        # Refuse to rank rather than produce a confident-looking answer from
        # nothing. A single symptom used to return "Paralysis (brain
        # haemorrhage), 22.85%" for a lone headache — a ranked list with a
        # percentage reads as a diagnosis no matter what caveat sits above it.
        #
        # Two independent floors, because they catch different failures: one
        # symptom is never enough to discriminate 41 conditions however sharp
        # the probability looks, and a flat distribution means no signal even
        # when several symptoms were given. The bar is deliberately low —
        # measured, realistic 5-symptom inputs land at 27-38%, so anything
        # stricter would suppress legitimate queries.
        if len(matched_canon) < MIN_SYMPTOMS or top < MIN_TOP_PROBABILITY:
            reason = (
                f"A single symptom cannot distinguish between {len(self.classes)} "
                "conditions. Add at least one more."
                if len(matched_canon) < MIN_SYMPTOMS
                else "These symptoms are too general to point anywhere in particular."
            )
            return DiseaseResponse(
                predictions=[],
                resolved_symptoms=resolved,
                unmatched_inputs=unmatched,
                suggested_symptoms=self._suggest(int(order[0]), set(matched_canon)),
                confidence_level="low",
                # Prepend, don't replace: the user still needs to be told that
                # "hiv" was dropped as a condition, which is usually the very
                # reason too few symptoms were left to assess.
                warnings=[f"No assessment produced. {reason}", *warnings],
                disclaimer=DISCLAIMER,
            )

        if len(matched_canon) < 3:
            warnings.append(
                "Few symptoms provided — predictions are less reliable. "
                "Add more symptoms for a better assessment."
            )

        predictions: list[DiseasePrediction] = []
        for idx in order:
            typical, text = self._explain(int(idx), matched_canon)
            predictions.append(DiseasePrediction(
                disease=self.classes[idx],
                confidence=round(float(proba[idx]) * 100, 2),
                matched_symptoms=typical,
                explanation=text,
            ))

        # Confidence level from top probability + margin over runner-up.
        top = float(proba[order[0]])
        margin = top - float(proba[order[1]]) if len(order) > 1 else top
        if top >= 0.6 and margin >= 0.2:
            level = "high"
        elif top >= 0.35:
            level = "moderate"
        else:
            level = "low"
        if level != "high":
            warnings.append(
                "Symptoms are not specific enough to be confident — "
                "answer the suggested follow-up symptoms."
            )

        suggestions = self._suggest(int(order[0]), set(matched_canon))

        return DiseaseResponse(
            predictions=predictions,
            resolved_symptoms=resolved,
            unmatched_inputs=unmatched,
            suggested_symptoms=suggestions,
            confidence_level=level,
            warnings=warnings,
            disclaimer=DISCLAIMER,
        )

    def all_symptoms(self) -> list[str]:
        return [humanize(f) for f in self.features]

    def autocomplete(self, q: str, limit: int = 8) -> list[str]:
        return self.matcher.suggest(q, limit=limit)


@lru_cache(maxsize=1)
def get_service() -> DiseaseService:
    return DiseaseService()
