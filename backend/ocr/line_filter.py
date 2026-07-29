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
    # institution / specialty letterhead. Measured: "INSTITUTES OF
    # GASTROENTEROLOGY" was matching "gastro 20 tablet".
    # post-nominal qualifications and specialty abbreviations. Measured:
    # "CRCP (Uk) FRCP (Gastro)" — the OCR of a credentials line — was matching
    # "gastro 20 tablet".
    "mbbs", "mrcp", "frcp", "mrcs", "frcs", "dnb", "dm", "mch", "phd", "dip",
    "diploma", "fellow", "fellowship", "resident", "registrar", "pgdhs",
    "gastro", "cardio", "neuro", "ortho", "paed", "ped", "derma", "onco",
    "patho", "radio", "uk", "usa", "ex",
    "child", "children", "childrens", "womens", "general", "multispeciality",
    "multispecialty", "nursing", "home", "polyclinic", "dispensary",
    "institute", "institutes", "institution", "hospitals", "clinics", "healthcare",
    "diagnostics", "laboratory", "labs", "gastroenterology", "cardiology",
    "neurology", "orthopedics", "orthopaedics", "pediatrics", "paediatrics",
    "dermatology", "oncology", "radiology", "pathology", "gynecology",
    "gynaecology", "psychiatry", "urology", "nephrology", "pulmonology",
    "gastroenterologist", "cardiologist", "neurologist", "pediatrician",
    "paediatrician", "dermatologist", "oncologist", "radiologist",
})

#: A line opening with one of these is a person's name (doctor or patient), not a
#: drug. Checked on the FIRST token only, so "Azenac MR" — where MR is a
#: modified-release suffix — is unaffected.
TITLE_TOKENS = frozenset({
    "dr", "doctor", "prof", "professor", "mr", "mrs", "ms", "miss", "shri", "smt",
})

#: English function words. These are the sharpest available signal for narrative
#: prose: a discharge note or medical certificate is full of them, while a drug
#: line ("Paracetamol 650mg", "Advent drops", "TAB ANDIAL") contains essentially
#: none. Measured over real letterhead/prose vs real drug lines, this separated
#: 26/28 with **zero** drug lines wrongly rejected — the direction that matters,
#: since a dropped line is a medicine the clinician never sees.
FUNCTION_WORDS = frozenset("""
a an the and or but if then than that this these those of in on at to from by for
with without within into onto over under above below is are was were be been being
am do does did done has have had having he she it they them his her its their we us
our you your i my me not no nor so such as also very more most much many few all any
both each other another same who whom whose which what when where why how there here
already currently further please kindly may might must shall should will would can
could about after before during while until since again once only just even still
concern ever needful thanking regards
""".split())

_TIME_RE = re.compile(r"\b\d{1,2}\s*[.:]\s*\d{2}\s*(?:am|pm)\b", re.IGNORECASE)
_PHONE_RE = re.compile(r"\b\d{6,}\b")
_TOKEN_SPLIT_RE = re.compile(r"[^a-z]+")


def _reads_as_prose(tokens: list[str]) -> bool:
    """True when the tokens read as a sentence rather than a prescription line.

    Two function words is already conclusive ("to whom ... it may concern"); one
    is enough on a longer line ("he further needs hospital stay"). Short lines are
    never judged this way, because a legitimate two-word drug line can contain an
    ordinary word ("Advent drops").
    """
    hits = sum(1 for t in tokens if t in FUNCTION_WORDS)
    return hits >= 2 or (hits >= 1 and len(tokens) >= 5)


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

    # A line opening with a title is a person's name — "Dr B. Who" was matching
    # "dr 4 tablet", and "Ms/Mr Patient 30" matching "movexx mr tablet".
    if tokens and tokens[0] in TITLE_TOKENS:
        return False, f"starts with the title {tokens[0]!r}"

    # Narrative prose. Referral letters, discharge summaries and medical
    # certificates are full sentences; matching them against a 248k-name index
    # invents drugs from ordinary words ("he further needs..." -> "need syrup").
    if _reads_as_prose(tokens):
        return False, "reads as narrative prose, not a prescription line"

    hits = [t for t in tokens if t in NON_MEDICINE_TOKENS]
    # Two admin words is conclusive; on a very short line even one is, since
    # there is no room for an actual drug name beside it.
    if hits and (len(hits) >= 2 or len(tokens) <= 2):
        return False, f"letterhead/form wording: {', '.join(hits)}"

    return True, ""
