"""Decides whether an OCR line is plausibly a *medicine* line.

Every line the OCR engine returns used to be fed straight into the 248k-entry
medicine index. On a real prescription that means the clinic letterhead, the
phone numbers, the consulting timings and the form labels ("Name", "Age",
"Date") are all matched against drug names — and because the index is so large,
almost any fragment finds a high-scoring fuzzy match. The result was a
prescription for a 6-month-old reporting 31 medicines (diabetes, hypertension
and antidepressant drugs among them) when only 5 were written.

This module is the first of two gates. It answers a cheap question — *could
this line be a medicine at all?* — using signals that are independent of the
drug dictionary:

* **OCR confidence.** If the engine itself is only 0.7% sure it read the line,
  nothing downstream should present a confident drug name from it. Real
  medicine lines in testing score 0.65-0.93; letterhead noise scores 0.002-0.27.
* **Letterhead / form vocabulary.** Words like "clinic", "timings", "Age" never
  appear as a standalone prescribed item.
* **Shape.** Clock times, phone/registration numbers and mostly-punctuation
  strings are not medicines.

The second gate (match confirmation) lives in :mod:`backend.ocr.
medicine_intelligence` and judges whether a *match* is trustworthy. Keeping the
two separate matters: a line rejected here is not a medicine and is dropped,
whereas a line that fails confirmation is still a medicine line and is kept for
manual review.
"""

from __future__ import annotations

import re

from backend.config import settings

#: Words that belong to a prescription's letterhead, patient form or footer.
#: A line built mainly from these is administrative text, never a prescribed item.
NON_MEDICINE_TOKENS = frozenset({
    # patient form labels
    "name", "age", "sex", "gender", "date", "dob", "wt", "weight", "temp",
    "temperature", "bp", "pulse", "patient", "spo", "height",
    # clinician / facility
    "dr", "doctor", "clinic", "hospital", "medical", "centre", "center",
    "consultant", "physician", "surgeon", "mbbs", "md", "ms", "reg", "regd",
    # contact block
    "contact", "emergency", "address", "ph", "phone", "tel", "mob", "mobile",
    "case", "opp", "opposite", "road", "street", "nagar", "colony", "complex",
    "bank", "floor", "near", "branch",
    # schedule / footer
    "timings", "timing", "am", "pm", "signature", "sign", "advice", "diagnosis",
    "follow", "review", "revisit", "next", "visit",
})

_TIME_RE = re.compile(r"\b\d{1,2}\s*[.:]\s*\d{2}\s*(?:am|pm)\b", re.IGNORECASE)
_PHONE_RE = re.compile(r"\b\d{6,}\b")
_TOKEN_SPLIT_RE = re.compile(r"[^a-z]+")


def is_medicine_line(text: str, confidence: float | None) -> tuple[bool, str]:
    """Return ``(True, "")`` when ``text`` could be a medicine line.

    Otherwise returns ``(False, reason)`` where ``reason`` explains the
    rejection — surfaced in logs and useful when tuning the thresholds.

    ``confidence`` is the OCR engine's own 0..1 confidence for the line; pass
    ``None`` when the provider does not report one (cloud providers), in which
    case the confidence check is skipped rather than assumed to fail.
    """
    alpha = sum(c.isalpha() for c in text)
    if alpha < settings.OCR_MIN_MEDICINE_LETTERS:
        return False, f"only {alpha} letter(s)"

    if confidence is not None and confidence < settings.OCR_MIN_SEGMENT_CONFIDENCE:
        return False, f"OCR confidence {confidence:.3f} below floor"

    if _TIME_RE.search(text):
        return False, "looks like a clock time"

    if _PHONE_RE.search(text):
        return False, "looks like a phone/registration number"

    # Drug names are overwhelmingly alphabetic (plus a strength like "650mg").
    # A line that is mostly digits/punctuation is a code, dose grid or address.
    compact = text.replace(" ", "")
    if compact and alpha / len(compact) < 0.5:
        return False, "mostly digits/punctuation"

    tokens = [t for t in _TOKEN_SPLIT_RE.split(text.lower()) if t]
    hits = [t for t in tokens if t in NON_MEDICINE_TOKENS]
    # Two admin words is conclusive; on a very short line even one is, since
    # there is no room for an actual drug name beside it.
    if hits and (len(hits) >= 2 or len(tokens) <= 2):
        return False, f"letterhead/form wording: {', '.join(hits)}"

    return True, ""
