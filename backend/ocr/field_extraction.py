"""Grammar-based extraction of dosage / frequency / duration from a text line.

Works on either the LLM's pre-parsed hints or raw OCR lines. Everything is
regex + a curated abbreviation dictionary, so it's fast, deterministic, and
explainable (important for a medical tool).
"""

from __future__ import annotations

import re

# --- Frequency abbreviations (Latin sig codes used on prescriptions) --------
# Maps a normalized token -> human-readable meaning.
FREQUENCY_MAP: dict[str, str] = {
    "od": "Once daily",
    "qd": "Once daily",
    "om": "Once in the morning",
    "on": "Once at night",
    "bd": "Twice daily",
    "bid": "Twice daily",
    "tds": "Three times daily",
    "tid": "Three times daily",
    "qds": "Four times daily",
    "qid": "Four times daily",
    "hs": "At bedtime",
    "sos": "As needed",
    "prn": "As needed",
    "stat": "Immediately (single dose)",
    "ac": "Before food",
    "pc": "After food",
    "q4h": "Every 4 hours",
    "q6h": "Every 6 hours",
    "q8h": "Every 8 hours",
    "q12h": "Every 12 hours",
    "qhs": "At bedtime",
    "qwk": "Once weekly",
}

# Matches dosing patterns like 1-0-1, 1-1-1, 0-0-1 (morning-noon-night).
_SCHEDULE_RE = re.compile(r"\b([01½\d])\s*-\s*([01½\d])\s*-\s*([01½\d])\b")

# Strength: 650mg, 500 mg, 5ml, 10 mcg, 1g, 2.5mg
_STRENGTH_RE = re.compile(
    r"\b(\d+(?:\.\d+)?)\s*(mg|mcg|ml|gm?|iu|%|units?)\b", re.IGNORECASE
)

# Tablet/cap count: "1 tab", "2 tablets", "1 cap", "½ tablet"
_COUNT_RE = re.compile(
    r"\b(\d+(?:\.\d+)?|½|¼)\s*(tabs?|tablets?|caps?|capsules?|tsp|drops?|puffs?)\b",
    re.IGNORECASE,
)

# Duration: "5 days", "for 1 week", "x7", "× 10 days", "2/52" (weeks), "1/12" (months)
_DURATION_RE = re.compile(
    r"(?:for\s+)?(\d+)\s*(days?|d|weeks?|wks?|w|months?|mons?|mo|m)\b"
    r"|[x×]\s*(\d+)\b"
    r"|\b(\d+)\s*/\s*(7|52|12)\b",
    re.IGNORECASE,
)

_UNIT_FULL = {
    "d": "days", "day": "days", "days": "days",
    "w": "weeks", "wk": "weeks", "wks": "weeks", "week": "weeks", "weeks": "weeks",
    "m": "months", "mo": "months", "mon": "months", "mons": "months",
    "month": "months", "months": "months",
}


def _norm_token(t: str) -> str:
    return re.sub(r"[^a-z0-9]", "", t.lower())


def extract_frequency(text: str) -> tuple[str | None, str | None]:
    """Return (raw_freq_token, human_readable) or (None, None)."""
    # 1-0-1 style schedule first.
    m = _SCHEDULE_RE.search(text)
    if m:
        slots = m.groups()
        labels = ["morning", "noon", "night"]
        active = [labels[i] for i, v in enumerate(slots) if v not in ("0",)]
        raw = "-".join(slots)
        readable = ", ".join(active) if active else "no doses"
        return raw, readable.capitalize()

    # Sig-code abbreviations.
    for token in re.split(r"[\s,;/]+", text):
        key = _norm_token(token)
        if key in FREQUENCY_MAP:
            return token.strip(), FREQUENCY_MAP[key]
    return None, None


def extract_dosage(text: str) -> str | None:
    parts: list[str] = []
    m = _STRENGTH_RE.search(text)
    if m:
        parts.append(f"{m.group(1)}{m.group(2).lower()}")
    m = _COUNT_RE.search(text)
    if m:
        parts.append(f"{m.group(1)} {m.group(2).lower()}")
    return " ".join(parts) if parts else None


def extract_duration(text: str) -> str | None:
    m = _DURATION_RE.search(text)
    if not m:
        return None
    if m.group(1):  # "5 days" form
        unit = _UNIT_FULL.get(m.group(2).lower(), m.group(2).lower())
        n = int(m.group(1))
        return f"{n} {unit if n != 1 else unit.rstrip('s')}"
    if m.group(3):  # "x7" form -> assume days
        return f"{int(m.group(3))} days"
    if m.group(4) and m.group(5):  # "2/52" shorthand
        n = int(m.group(4))
        unit = {"7": "days", "52": "weeks", "12": "months"}[m.group(5)]
        return f"{n} {unit if n != 1 else unit.rstrip('s')}"
    return None


def extract_fields(text: str) -> dict[str, str | None]:
    """Convenience: pull all three fields from a single text line."""
    raw_freq, readable = extract_frequency(text)
    return {
        "dosage": extract_dosage(text),
        "frequency": raw_freq,
        "frequency_expanded": readable,
        "duration": extract_duration(text),
    }
