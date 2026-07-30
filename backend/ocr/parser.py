"""Extract structured prescription fields from raw OCR text.

Regex/keyword-based field extraction for the non-medicine parts of a script
(doctor, patient, vitals, advice, etc.). Medicine rows are handled by the
medicine-intelligence + field-extraction layers in the pipeline; this module
fills in the surrounding context to build the rich JSON output.

It is deliberately conservative: a field is only returned when a clear cue is
present, so we never fabricate a patient name or diagnosis.
"""

from __future__ import annotations

import re

_MONTH = r"(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*"
_DATE_RE = re.compile(
    r"\b(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}"
    r"|\d{4}[/\-.]\d{1,2}[/\-.]\d{1,2}"
    rf"|\d{{1,2}}\s+{_MONTH}\s+\d{{2,4}}"
    # Month-first ("July 18 2021", "Jul 18, 2021") — US-style dates appear on
    # hospital registration cards and were being dropped entirely.
    rf"|{_MONTH}\s+\d{{1,2}},?\s+\d{{2,4}})\b",
    re.IGNORECASE,
)
# Keep the unit in the capture: "Age 6 months" must yield "6 months", never a
# bare "6" that downstream code would read as six YEARS. `\s*` also admits the
# attached form ("6months") common on pediatric scripts.
_AGE_RE = re.compile(
    r"\b(?:age|aged)\s*[:\-]?\s*(\d{1,3}(?:\.\d+)?\s*(?:months?|mos?|weeks?|wks?|days?|yrs?|years?)?)\b"
    r"|\b(\d{1,3})\s*(?:yrs?|years?|y/o|yo)\b",
    re.IGNORECASE,
)
_GENDER_RE = re.compile(r"\b(male|female|m/f|f/m)\b|\b(?:sex|gender)\s*[:\-]?\s*([mf])\b", re.IGNORECASE)
# Require an explicit BP cue so we don't mistake a date (12/05) for blood pressure.
_BP_RE = re.compile(r"\bb\.?\s*p\.?\s*[:\-]?\s*(\d{2,3}\s*/\s*\d{2,3})\s*(?:mmhg)?\b", re.IGNORECASE)
_TEMP_RE = re.compile(r"\b(?:temp|temperature|t)\s*[:\-]?\s*(\d{2,3}(?:\.\d)?)\s*°?\s*([cf])?\b", re.IGNORECASE)
_PULSE_RE = re.compile(r"\b(?:pulse|hr|heart rate)\s*[:\-]?\s*(\d{2,3})\b", re.IGNORECASE)
_WEIGHT_RE = re.compile(r"\b(?:wt|weight)\s*[:\-]?\s*(\d{1,3}(?:\.\d)?)\s*(?:kg)?\b", re.IGNORECASE)
_SPO2_RE = re.compile(r"\b(?:spo2|sao2|o2)\s*[:\-]?\s*(\d{2,3})\s*%?\b", re.IGNORECASE)

# Section header -> field name. Name-like captures stay on one line ([^\n]) and
# are trimmed at the next field label; rest-of-line captures grab to EOL and are
# then bounded by _bound_value (see below).
_NAME = r"([A-Za-z][A-Za-z. ]{1,40})"
_REST = r"([^\n]+)"
_LABELLED = {
    # `\b` after the cue so "drops" cannot match as "Dr" + name "ops".
    "doctor": re.compile(rf"\b(?:dr\.?|doctor)\b\s*[:.\-]?\s*{_NAME}", re.IGNORECASE),
    "patient": re.compile(rf"\b(?:patient|name|pt)\s*[:\-]\s*{_NAME}", re.IGNORECASE),
    # "Complaints/History:" is one label on hospital cards, and "C/o" is written
    # without a colon — both were missed, leaving diagnosis null on a page that
    # states it plainly.
    "diagnosis": re.compile(
        rf"\b(?:(?:diagnosis|dx|impression|complaints?(?:\s*/\s*history)?)\s*[:\-]|c/o)\s*{_REST}",
        re.IGNORECASE),
    "advice": re.compile(
        rf"\b(?:advice|advise|(?:treatment\s*/\s*)?instructions?)\s*[:\-]\s*{_REST}", re.IGNORECASE),
    "follow_up": re.compile(rf"\b(?:follow[ \t\-]?up|review|revisit|next visit)\s*[:\-]?\s*{_REST}", re.IGNORECASE),
    "investigations": re.compile(rf"\b(?:investigations?|tests?|lab|labs)\s*[:\-]\s*{_REST}", re.IGNORECASE),
}
_HOSPITAL_CUE_RE = re.compile(
    r"\b(hospital|clinic|nursing home|medical centre|medical center|healthcare|polyclinic)\b",
    re.IGNORECASE,
)
# Longest a parsed field may be. A vision model returns the whole page as one
# flowing paragraph, so any "rest of line" capture is really "rest of document"
# unless it is bounded — measured: the hospital field held a full 500-character
# transcription, which the UI then rendered as the clinic's name.
_MAX_FIELD = 200
# The start of the NEXT labelled field in a run-on line ("... Examination: CVS").
# Anchored to a statement boundary: an unanchored search matches mid-sentence
# ("Inj. Pantop IV Stat. Signature:" -> cut at "Pantop") and truncates the value
# it was meant to protect. A letter start keeps dosing ratios ("1:1") out.
# At most 2 extra words: real labels are short ("Signature:", "C/T findings:",
# "Treatment/Instructions:"), and a wider window lets the pattern reach a later
# colon from mid-sentence ("Pantop IV Stat. Signature:" -> cut at "Pantop").
_NEXT_LABEL_RE = re.compile(
    r"(?:^|(?<=[.;\n]))\s*[A-Za-z][A-Za-z]*(?:[ /][A-Za-z.]+){0,2}\s*:"
)
# Sentence boundary, used to narrow a run-on paragraph down to one statement.
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.;])\s+")
# Stop a name capture at the next inline label so "John Doe  Age: 45" -> "John Doe".
# Patient titles (ms/mr/baby/s-o-...) stop it too: a VLM transcribes the header as
# one flowing line, and "Dr. R. Keshwani. Ms. Prathna. Date ..." otherwise leaves
# the patient's name glued onto the doctor's (measured on 2.jpg).
_NAME_STOP = re.compile(
    r"\b(age|aged|sex|gender|date|dob|m/f|f/m|years?|yrs?"
    r"|ms|mr|mrs|miss|master|baby|b/o|s/o|d/o|w/o)\b\.?",
    re.IGNORECASE,
)


def age_to_years(age: str | int | float | None) -> int | None:
    """Convert an age-as-written to whole years, or None when unparseable.

    The clinical rules take an integer age in YEARS, but a prescription writes
    age in whatever unit fits the patient: "45", "45 yrs", "45/M", "6 months",
    "6months", "3 wks", "10 days", or the clinical fraction "6/12". Sub-year
    ages floor to 0 — that is exactly the signal the infant (<2) rules key on,
    and reading the bare digits ("6 months" -> 6) would grade an infant as a
    six-year-old and silence them.

    A single letter after the number is ambiguous: attached ("6m") is the
    pediatric months shorthand, while separated ("45 M", "45/M") is a sex
    marker and the number stays years.
    """
    if age is None:
        return None
    if isinstance(age, (int, float)):
        return int(age) if age >= 0 else None
    s = str(age).strip().lower()
    if not s:
        return None
    if (m := re.fullmatch(r"(\d{1,2})\s*/\s*12", s)):     # "6/12" = 6 months
        return int(m.group(1)) // 12
    m = re.search(r"\d{1,3}(?:\.\d+)?", s)
    if not m:
        return None
    value = float(m.group(0))
    rest = s[m.end():]
    unit = (re.match(r"[\s/:\-]*([a-z]+)", rest) or [None, ""])[1]
    attached = bool(rest[:1].isalpha())                    # "6m" vs "45 m"
    if unit.startswith("mo") or (unit == "m" and attached):
        return int(value // 12)
    if unit.startswith(("wk", "week")) or (unit == "w" and attached):
        return int(value // 52)
    if unit.startswith("day") or unit == "d":
        return int(value // 365)
    return int(value)


def _clean(s: str | None) -> str | None:
    if not s:
        return None
    s = re.sub(r"[ \t]+", " ", s).strip(" :-.,")
    return s or None


def _clean_name(s: str | None) -> str | None:
    s = _clean(s)
    if not s:
        return None
    s = _NAME_STOP.split(s, maxsplit=1)[0]  # cut at the next label keyword
    return _clean(s)


def _bound_value(s: str | None) -> str | None:
    """Trim a rest-of-line capture at the next "Label:" and cap its length.

    On line-structured OCR output this is a no-op. On a vision model's run-on
    paragraph it is what stops one field from swallowing the rest of the page:
    "C/o Pain in abdomen. Known case of T2DM / HTN. Examination: CVS ..." must
    yield the complaint, not everything that follows it.
    """
    s = _clean(s)
    if not s:
        return None
    if (m := _NEXT_LABEL_RE.search(s)):
        s = s[: m.start()]
    s = (_clean(s) or "")[:_MAX_FIELD]
    return _clean(s)


def _find_hospital(text: str) -> str | None:
    """The institution line, narrowed to one statement on run-on text."""
    for line in text.split("\n"):
        if not _HOSPITAL_CUE_RE.search(line):
            continue
        segment = line
        if len(segment) > _MAX_FIELD:
            for sentence in _SENTENCE_SPLIT_RE.split(line):
                if _HOSPITAL_CUE_RE.search(sentence):
                    segment = sentence
                    break
        return (_clean(segment) or "")[:_MAX_FIELD] or None
    return None


def parse_fields(full_text: str, lines: list[str] | None = None) -> dict:
    text = full_text or ""
    out: dict = {
        "doctor": None,
        "hospital": None,
        "patient": None,
        "age": None,
        "gender": None,
        "date": None,
        "diagnosis": None,
        "advice": None,
        "follow_up": None,
        "investigations": None,
        "vitals": {},
    }

    for field, rx in _LABELLED.items():
        m = rx.search(text)
        if m:
            value = (
                _clean_name(m.group(1)) if field in {"doctor", "patient"}
                else _bound_value(m.group(1))
            )
            out[field] = value

    # Many Indian hospitals are named after a person and so begin with "Dr."
    # ("Dr. Baba Saheb Ambedkar Hospital"). The doctor cue fires on that and
    # reports the institution as the physician; it is not one.
    if out["doctor"] and _HOSPITAL_CUE_RE.search(out["doctor"]):
        out["doctor"] = None

    out["hospital"] = _find_hospital(text)

    if (m := _DATE_RE.search(text)):
        out["date"] = m.group(1)

    if (m := _AGE_RE.search(text)):
        out["age"] = m.group(1) or m.group(2)

    if (m := _GENDER_RE.search(text)):
        g = (m.group(1) or m.group(2) or "").lower()
        out["gender"] = {"m": "Male", "f": "Female", "male": "Male", "female": "Female"}.get(g)

    vitals = out["vitals"]
    if (m := _BP_RE.search(text)):
        vitals["blood_pressure"] = re.sub(r"\s*/\s*", "/", m.group(1)) + " mmHg"
    if (m := _TEMP_RE.search(text)):
        unit = (m.group(2) or "F").upper()
        vitals["temperature"] = f"{m.group(1)}°{unit}"
    if (m := _PULSE_RE.search(text)):
        vitals["pulse"] = f"{m.group(1)} bpm"
    if (m := _WEIGHT_RE.search(text)):
        vitals["weight"] = f"{m.group(1)} kg"
    if (m := _SPO2_RE.search(text)):
        vitals["spo2"] = f"{m.group(1)}%"

    return out
