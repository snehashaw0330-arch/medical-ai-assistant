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
# line_filter depends only on config, so this import cannot cycle.
from backend.ocr.line_filter import FUNCTION_WORDS

try:
    import jellyfish  # type: ignore

    _HAS_PHONETIC = True
except Exception:  # noqa: BLE001
    _HAS_PHONETIC = False


# Words/strengths that add noise to matching but not identity.
#
# Keep this list exhaustive for the ABBREVIATIONS a prescriber actually writes,
# not just the full words. A missing one does not merely weaken the match, it
# corrupts it: "syp" was absent, so "Syp. Meftal-P" scored 42 against
# "meftal-p suspension" (vs 100 for the bare name) and, worse, "Syp. Mucolite
# LS" resolved to the WRONG product "s-mucolite syrup" because the stray "syp"
# fused into the "s-" prefix. That was the only invented false positive on the
# 25-label benchmark. Word boundaries keep these safe inside real brand names
# ("hexigel" survives \bgel\b, "sypod" survives \bsyp\b).
_FORM_WORDS = re.compile(
    r"\b(tablet|tablets|tab|tabs|capsule|capsules|cap|caps|"
    r"syrup|syp|syr|suspension|susp|solution|soln|elixir|tonic|"
    r"injection|inj|vial|ampoule|amp|infusion|"
    r"drops?|cream|ointment|oint|gel|lotion|spray|inhaler|rotacap|respules|"
    r"granules|powder|sachet|sachets|paint|gum|gargle|mouthwash|"
    # NOT stripped: nasal / eye / ear / topical. Those are route descriptors
    # that distinguish real products from each other ("X eye drops" vs "X ear
    # drops"), and this same normalize() backs the benchmark's own name
    # agreement rule — collapsing them would make the instrument accept a
    # wrong-route match as exact, hiding a defect instead of measuring it.
    r"mg|mcg|ml|gm?|iu)\b",
    re.IGNORECASE,
)
_STRENGTH = re.compile(r"\b\d+(?:\.\d+)?\b")
_NON_ALNUM = re.compile(r"[^a-z0-9 ]")

#: A dose-form abbreviation written with a PERIOD at the start of a drug line
#: ("T. Pan 40mg", "C. Amoxil", "Inj. Remdesivir"). The period is the whole
#: signal and the reason this cannot be folded into _FORM_WORDS as a bare "t":
#:
#:   "T. Pan 40mg"  -> Tablet + Pan   -> must strip, or it matched the unrelated
#:                                       product "t pan 40mg tablet"
#:   "T-Minic"      -> the drug itself -> must NOT strip
#:   "T Minic"      -> the drug itself -> must NOT strip
#:
#: Measured on 33.jpg: with the prefix left in, "T. Azee 500mg" and "T. Dolo 650"
#: both went unresolved while the bare names resolved perfectly.
_LEADING_FORM_ABBREV = re.compile(r"^\s*[a-z]{1,4}\.\s*(?=\S)", re.IGNORECASE)


def strip_leading_form_abbrev(text: str) -> str:
    """Drop a leading "T." / "Tab." / "Inj." style abbreviation from a drug line."""
    return _LEADING_FORM_ABBREV.sub("", text or "", count=1)


def normalize(name: str) -> str:
    s = name.lower()
    s = _FORM_WORDS.sub(" ", s)
    s = _STRENGTH.sub(" ", s)
    s = _NON_ALNUM.sub(" ", s)
    return re.sub(r"\s+", " ", s).strip()


#: A strength token — "650mg", "0.125", "25 mg", or a bare unit. ``normalize``
#: only strips digits delimited by word boundaries, so a fused "650mg" survives
#: it intact; left in, that token drags an otherwise perfect match down.
_STRENGTH_TOKEN_RE = re.compile(
    r"^(?:\d+(?:\.\d+)?)?(?:mg|mgs|ml|mcg|gm|gms|g|iu|units?|cc|mm|%)?$"
)


#: A single-token product name at least this long is distinctive enough that
#: matching one token of the query is real evidence. Below it, the whole query
#: must account for the name — otherwise 2-3 character brands ("om", "af",
#: "dat") harvest stray OCR fragments. Measured: 553 of the 209k names in the
#: dataset are <=3 characters and 725 are ordinary English words, so short
#: names collide with noise constantly.
_DISTINCTIVE_NAME_LEN = 5

#: How many WRatio candidates to re-rank by identity agreement before returning.
#: Large enough that the correct product survives WRatio's preference for short
#: substring matches — "asthakind tablet" ranks fifth for the query "arthakind
#: drops" — and small enough that the extra scoring stays negligible.
_CANDIDATE_POOL = 40


#: Generic-label manufacturers. Their product names are "<maker> <molecule>
#: <strength> <form>", so stripping the maker leaves the INN/molecule name. This
#: is the only place the dataset carries generic names at all: its `name` and
#: `substitute*` columns are brands, and `Chemical Class` is a drug *class*, not
#: a molecule. Without this derivation a generically-written prescription can
#: only match by accident — measured, that capped recall at 0.588 with the drug
#: read correctly and then dropped as unresolved.
_GENERIC_LABEL_PREFIXES = ("davaindia ", "genericart ", "stayhappi ", "generico ")

#: Shortest derived generic name worth indexing. Below this a "molecule" is
#: almost always a truncation artefact and behaves like the 2-3 character brands
#: that _DISTINCTIVE_NAME_LEN exists to keep out.
_MIN_GENERIC_LEN = 5


def _identity_tokens(text: str) -> str:
    """Normalised text reduced to the tokens that actually identify the drug.

    Strength and unit tokens are dropped from *both* sides of a comparison, so
    "Paracetamol 650mg" and "paracetamol tablet" reduce to the same string
    instead of scoring 78.6 against each other.
    """
    return " ".join(
        t for t in normalize(text).split() if not _STRENGTH_TOKEN_RE.match(t)
    )


@dataclass
class MedicineMatch:
    name: str          # original display name from the dataset
    score: float       # 0..100 combined confidence
    confirm: float = 0.0   # 0..100 whole-word agreement — see confirm_score()


def confirm_score(query: str, name: str) -> float:
    """How strongly ``query`` agrees with ``name`` at *whole-word* level (0..100).

    ``search`` ranks with :func:`rapidfuzz.fuzz.WRatio`, which folds in
    ``partial_ratio`` — a substring match. Against a 248k-name dictionary that
    is far too generous: any 4-letter fragment sits inside *some* product name,
    so "date" scores 93.7 against "dat cream" and "Timings" scores 81.5 against
    "t-98 tablet". WRatio returns exactly 90.0 for most such fragments, which is
    comfortably above the accept threshold.

    ``token_set_ratio`` instead asks whether the two strings share complete
    words. Measured over the real dataset that cleanly separates the two
    populations: genuine matches score 92-100 ("Paracetmol 500" -> "paracetamol
    tablet" = 95.2), while letterhead noise tops out at 85.7 ("date" ->
    "dat cream"). It is used to *confirm* what WRatio proposes, never to rank.

    For a single-token product name the comparison is length-aware, because the
    two failure modes pull in opposite directions:

    * ``token_set_ratio`` returns 100 whenever the candidate appears as a token
      of the query, so the fragment "Wu Om" scored a perfect 100 against
      "om suspension". Short names need the *whole* query to account for them.
    * Whole-string ``ratio`` punishes the extra words a real prescription line
      carries, so "Advent drops 0.8ml TDS 3 days" scored 57 against "advent" —
      a correct match rejected for being written out in full.

    A name of five characters or more is distinctive enough that matching one
    query token is real evidence, so those compare against the best-matching
    token. Anything shorter must be accounted for by the entire query, which is
    what keeps "om", "af" and "dat" from harvesting stray fragments.
    """
    q, core = _identity_tokens(query), _identity_tokens(name)
    if not q or not core:
        return 0.0

    if len(core.split()) > 1:
        # A multi-word product ("nasoclear plus", "zofer md"). ``token_set_ratio``
        # credits a query that is a subset of it, which is what lets a brand line
        # match its extended dictionary entry. That is only evidence when the
        # shared token is distinctive: the segment "days" is a subset of
        # "days sr" and scored 100. Fall back to order-sensitive comparison when
        # nothing substantial is shared.
        shared = set(q.split()) & set(core.split())
        if any(len(t) >= _DISTINCTIVE_NAME_LEN for t in shared):
            return float(fuzz.token_set_ratio(q, core))
        return float(fuzz.token_sort_ratio(q, core))

    if len(core) >= _DISTINCTIVE_NAME_LEN:
        # Compare against the best-matching query token, so a name written out in
        # full ("Advent drops 0.8ml TDS") still matches. Function words are never
        # drug names and are skipped — otherwise "TDS after food" matched
        # "lafter 10 tablet" on the strength of "after" alone.
        tokens = [t for t in q.split() if t not in FUNCTION_WORDS] or q.split()
        return max((float(fuzz.ratio(t, core)) for t in tokens), default=0.0)

    return float(fuzz.ratio(q, core))


class MedicineIndex:
    """Loads the medicine dataset once and serves fuzzy/phonetic lookups."""

    def __init__(self, csv_path: str) -> None:
        df = pd.read_csv(csv_path, low_memory=False)
        df = df[df["name"].notna()].reset_index(drop=True)
        self.df = df

        self._display: list[str] = df["name"].astype(str).tolist()
        self._clean: list[str] = [normalize(n) for n in self._display]

        # Generic/molecule names derived from the generic-label makers, appended
        # as first-class searchable entries. Each points back at a real row so
        # details() still returns that molecule's uses and side effects.
        self._generic_names: set[str] = set()
        self._add_generic_names()

        # Map clean name -> first row index, for detail lookup.
        self._row_for_clean: dict[str, int] = {}
        for i, c in enumerate(self._clean):
            self._row_for_clean.setdefault(c, i)

        # First-letter buckets: char -> list of row indices.
        self._buckets: dict[str, list[int]] = {}
        for i, c in enumerate(self._clean):
            key = c[0] if c else "#"
            self._buckets.setdefault(key, []).append(i)

    def _add_generic_names(self) -> None:
        """Append molecule names recovered from generic-label product names.

        ``self._row_index_for`` keeps each derived name pointing at the real row
        it came from, so a generic hit still carries real uses/side-effects. The
        derived name is only added when the dataset does not already contain it
        as a product in its own right.
        """
        existing = set(self._clean)
        self._row_index_for: list[int] = list(range(len(self._display)))
        derived: dict[str, int] = {}
        for i, display in enumerate(self._display):
            low = str(display).lower()
            prefix = next((p for p in _GENERIC_LABEL_PREFIXES if low.startswith(p)), None)
            if prefix is None:
                continue
            molecule = _identity_tokens(low[len(prefix):])
            if len(molecule) < _MIN_GENERIC_LEN or molecule in existing:
                continue
            derived.setdefault(molecule, i)

        for molecule, row in derived.items():
            self._display.append(molecule)
            self._clean.append(molecule)
            self._row_index_for.append(row)
            self._generic_names.add(molecule)

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
        # Strip a leading "T." / "Inj." style abbreviation on the QUERY side only.
        # Dataset names never carry one, and doing it here (before normalize)
        # means the stripped form also reaches confirm_score below.
        q = normalize(strip_leading_form_abbrev(query))
        if not q:
            return []

        idxs = self._candidate_indices(q)
        choices = {i: self._clean[i] for i in idxs}

        # The pool is deliberately much larger than ``limit`` and independent of
        # it. WRatio decides only what gets *considered*; the ranking below is by
        # identity agreement. Tying the pool to ``limit`` meant a caller asking
        # for one result fetched four candidates, and the correct product — which
        # WRatio had ranked fifth — could not be recovered by any re-ranking.
        pool = max(limit * 4, _CANDIDATE_POOL)
        results = process.extract(q, choices, scorer=fuzz.WRatio, limit=pool)
        # results: list of (clean_value, score, key_index)

        # If the bucket gave us weak matches, retry against the full list once.
        # Measured to add recall without adding noise, now that acceptance is
        # judged by confirm_score rather than by this ranking score.
        if (not results or results[0][1] < 80) and len(idxs) < len(self._clean):
            full = {i: self._clean[i] for i in range(len(self._clean))}
            results = process.extract(q, full, scorer=fuzz.WRatio, limit=pool)

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

            scored.append(
                MedicineMatch(
                    name=display,
                    score=round(combined, 1),
                    confirm=round(confirm_score(q, clean_val), 1),
                )
            )

        # Rank by identity agreement first, ranking score second.
        #
        # WRatio is a good *recall* device — it proposes candidates despite OCR
        # noise — but a poor ranker, because ``partial_ratio`` rewards a short
        # name for sitting inside the query. Searching "Omeprazole" put
        # "omep 20 capsule" (W=86.5) above "omeparazole 20mg capsule", so the
        # correct product never reached the caller and a perfectly-read line went
        # unresolved. Ordering by ``confirm`` puts whole-name agreement first
        # (57.1 vs 95.2 for that pair) and keeps WRatio as the tie-breaker.
        scored.sort(key=lambda m: (m.confirm, m.score), reverse=True)
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
        # Derived generic entries live past the end of the dataframe; each maps
        # back to the real row it was recovered from, whose uses/side-effects are
        # that molecule's. Indexing self.df directly would raise here.
        row = self.df.iloc[self._row_index_for[idx]]

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
            # A derived generic entry reports the molecule, not the generic-label
            # product it was recovered from ("azithromycin", not "davaindia
            # azithromycin 500mg tablet") — the molecule is what was prescribed.
            "name": display_name if clean in self._generic_names else str(row["name"]),
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
