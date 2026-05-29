"""Medicine recognition layer: correct OCR output against the drug dictionary.

This is where most of the real accuracy comes from. An OCR token like
"Azitromicin" or "Dolo650" is matched against ~248k Indian brand/generic names
using a blend of:

* fuzzy similarity (rapidfuzz WRatio) -- handles insertions/deletions/typos
* phonetic similarity (metaphone, if ``jellyfish`` is installed) -- handles
  "ph"/"f", "c"/"k", silent letters common in handwriting misreads

First-letter "blocking" keeps it fast: we usually only score the bucket whose
initial matches, falling back to the full list when confidence is low.

For very high request volumes, move this into Postgres with a ``pg_trgm`` GIN
index and query with ``similarity()`` -- same scoring idea, set-based speed.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache

import pandas as pd
from rapidfuzz import fuzz, process

from backend.config import settings

try:
    import jellyfish  # type: ignore

    _HAS_PHONETIC = True
except Exception:  # noqa: BLE001
    _HAS_PHONETIC = False


# Words/strengths that add noise to matching but not identity.
_FORM_WORDS = re.compile(
    r"\b(tablet|tablets|tab|capsule|capsules|cap|syrup|injection|inj|"
    r"suspension|susp|drops?|cream|ointment|gel|solution|sachet|"
    r"mg|mcg|ml|gm?|iu)\b",
    re.IGNORECASE,
)
_STRENGTH = re.compile(r"\b\d+(?:\.\d+)?\b")
_NON_ALNUM = re.compile(r"[^a-z0-9 ]")


def normalize(name: str) -> str:
    s = name.lower()
    s = _FORM_WORDS.sub(" ", s)
    s = _STRENGTH.sub(" ", s)
    s = _NON_ALNUM.sub(" ", s)
    return re.sub(r"\s+", " ", s).strip()


@dataclass
class MedicineMatch:
    name: str          # original display name from the dataset
    score: float       # 0..100 combined confidence


class MedicineIndex:
    """Loads the medicine dataset once and serves fuzzy/phonetic lookups."""

    def __init__(self, csv_path: str) -> None:
        df = pd.read_csv(csv_path, low_memory=False)
        df = df[df["name"].notna()].reset_index(drop=True)
        self.df = df

        self._display: list[str] = df["name"].astype(str).tolist()
        self._clean: list[str] = [normalize(n) for n in self._display]

        # Map clean name -> first row index, for detail lookup.
        self._row_for_clean: dict[str, int] = {}
        for i, c in enumerate(self._clean):
            self._row_for_clean.setdefault(c, i)

        # First-letter buckets: char -> list of row indices.
        self._buckets: dict[str, list[int]] = {}
        for i, c in enumerate(self._clean):
            key = c[0] if c else "#"
            self._buckets.setdefault(key, []).append(i)

    # -- matching ----------------------------------------------------------
    def _candidate_indices(self, query_clean: str) -> list[int]:
        if not query_clean:
            return list(range(len(self._clean)))
        key = query_clean[0]
        bucket = self._buckets.get(key, [])
        # If the bucket is tiny, widen to neighbouring keys to be safe.
        if len(bucket) < 200:
            return list(range(len(self._clean)))
        return bucket

    def search(self, query: str, limit: int = 3) -> list[MedicineMatch]:
        q = normalize(query)
        if not q:
            return []

        idxs = self._candidate_indices(q)
        choices = {i: self._clean[i] for i in idxs}

        results = process.extract(
            q, choices, scorer=fuzz.WRatio, limit=limit * 4
        )
        # results: list of (clean_value, score, key_index)

        # If the bucket gave us weak matches, retry against the full list once.
        if (not results or results[0][1] < 80) and len(idxs) < len(self._clean):
            full = {i: self._clean[i] for i in range(len(self._clean))}
            results = process.extract(q, full, scorer=fuzz.WRatio, limit=limit * 4)

        q_phon = jellyfish.metaphone(q) if _HAS_PHONETIC else None

        scored: list[MedicineMatch] = []
        seen_display: set[str] = set()
        for clean_val, score, idx in results:
            display = self._display[idx]
            if display in seen_display:
                continue
            seen_display.add(display)

            combined = float(score)
            if q_phon:
                cand_phon = jellyfish.metaphone(clean_val)
                if cand_phon and cand_phon == q_phon:
                    combined = min(100.0, combined + 8.0)  # phonetic agreement
                elif cand_phon:
                    pr = fuzz.ratio(q_phon, cand_phon)
                    combined = 0.85 * combined + 0.15 * pr

            scored.append(MedicineMatch(name=display, score=round(combined, 1)))

        scored.sort(key=lambda m: m.score, reverse=True)
        return scored[:limit]

    # -- details -----------------------------------------------------------
    def details(self, display_name: str) -> dict:
        clean = normalize(display_name)
        idx = self._row_for_clean.get(clean)
        if idx is None:
            # Fall back to exact display match.
            try:
                idx = self._display.index(display_name)
            except ValueError:
                return {}
        row = self.df.iloc[idx]

        def collect(prefix: str, count: int) -> list[str]:
            out = []
            for n in range(count):
                col = f"{prefix}{n}"
                if col in row and pd.notna(row[col]) and str(row[col]).strip():
                    out.append(str(row[col]).strip())
            return out

        def field(col: str) -> str:
            return str(row[col]).strip() if col in row and pd.notna(row[col]) else ""

        return {
            "name": str(row["name"]),
            "uses": collect("use", 5),
            "side_effects": collect("sideEffect", 10),
            "substitutes": collect("substitute", 5),
            "chemical_class": field("Chemical Class"),
            "therapeutic_class": field("Therapeutic Class"),
            "action_class": field("Action Class"),
            "habit_forming": field("Habit Forming"),
        }


@lru_cache(maxsize=1)
def get_index() -> MedicineIndex:
    """Singleton index, built on first use."""
    return MedicineIndex(settings.MEDICINE_CSV)
