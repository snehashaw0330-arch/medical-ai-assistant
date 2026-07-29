"""Confidence scoring + engine selection.

The smartest selection signal for a *medical* prescription isn't raw OCR
confidence — it's how much of the output actually matches real medicine names.
We combine three signals:

* engine self-confidence (mean over lines)
* dictionary agreement (fraction of lines that strongly match a medicine)
* text volume (engines that read more real words usually win ties)
"""

from __future__ import annotations

from backend.config import settings
from backend.ocr.engines.base import EngineResult
from backend.ocr.line_filter import is_medicine_line


def dictionary_agreement(result: EngineResult, index) -> float:
    """Fraction of plausible medicine lines that resolve to a *confirmable* drug.

    This counts only what the extraction pipeline would actually accept — the
    same line gate and the same whole-word confirmation. That alignment matters
    more than it looks. The previous version counted any line whose raw
    ``WRatio`` cleared 78, but WRatio folds in ``partial_ratio`` and returns ~90
    for almost any fragment against a 248k-name index. Since this is the
    heaviest term in :func:`engine_score`, the ensemble was effectively ranking
    engines by *how much drug-shaped noise they produced* — rewarding the
    hallucinating engine over the accurate one, with no ground truth anywhere in
    the loop to notice.
    """
    candidates = [l for l in result.lines if is_medicine_line(l.text, l.confidence)[0]]
    if not candidates:
        return 0.0
    hits = 0
    for line in candidates:
        matches = index.search(line.text, limit=1)
        if (
            matches
            and matches[0].score >= settings.MEDICINE_MATCH_THRESHOLD
            and matches[0].confirm >= settings.MEDICINE_CONFIRM_THRESHOLD
        ):
            hits += 1
    return hits / len(candidates)


def engine_score(result: EngineResult, index) -> float:
    """Overall quality score (0..1) used to rank engines for an image."""
    if not result.available or result.is_empty:
        return 0.0
    agree = dictionary_agreement(result, index)
    conf = result.mean_confidence or 0.5
    # Volume bonus saturates quickly so a verbose-but-wrong engine can't dominate.
    volume = min(len(result.lines) / 8.0, 1.0)
    return round(0.5 * agree + 0.35 * conf + 0.15 * volume, 4)


def select_best(results: list[EngineResult], index) -> tuple[EngineResult, dict]:
    """Pick the best engine result; return it plus a per-engine score table."""
    scored = [(r, engine_score(r, index)) for r in results]
    table = {
        r.engine: {
            "score": s,
            "mean_confidence": round(r.mean_confidence, 3),
            "lines": len(r.lines),
            "available": r.available,
            "error": r.error,
        }
        for r, s in scored
    }
    usable = [(r, s) for r, s in scored if s > 0]
    if not usable:
        # Nothing read anything useful — return the first available (or first).
        fallback = next((r for r in results if r.available), results[0])
        return fallback, table
    best = max(usable, key=lambda x: x[1])[0]
    return best, table
