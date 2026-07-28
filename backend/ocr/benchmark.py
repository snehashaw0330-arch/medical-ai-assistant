"""Score the prescription pipeline against hand-labelled ground truth (Phase 0).

This is the scorecard every later phase is judged against. It exists because the
metric that came before it — ``evaluation.build_metrics``' "medicine extraction
accuracy", the fraction of images that yielded *any* medicine — never compared a
prediction to a label and therefore rewarded guessing: it read ~100% while the
pipeline was fabricating 31 drugs from a 5-medicine prescription. Nothing in the
system could detect that. See ``docs/PRESCRIPTION_OCR_OVERHAUL.md`` §1.2.

Run it::

    ./venv/bin/python -m backend.ocr.benchmark        # or: make bench
    ./venv/bin/python -m backend.ocr.benchmark --split handwritten
    ./venv/bin/python -m backend.ocr.benchmark --provider gemini --tag gemini

Labels come from ``datasets/prescriptions/labels/`` (schema in that folder's
README). Each image goes through the *live* ``run_pipeline`` — the same code path
as ``POST /ocr/extract-prescription`` — and a markdown + JSON scorecard is
written to ``docs/benchmarks/``.

What is measured, and why each one
----------------------------------
**Medicine identity precision / recall / F1.** The pipeline's *claims* are the
rows it resolved to a name. Rows it left unresolved are not claims — they are
"I could not read this, please check" — so they cost recall but are never counted
as false positives. Scoring them as errors would reward dropping a doubtful row
over surfacing it, which is backwards for a clinician-in-the-loop tool; they are
reported separately as ``unresolved per prescription`` instead.

**False positives per prescription.** The headline safety number, and the one
that would have caught the 31-medicine bug the day it shipped. A drug the system
names that is not on the page is the failure mode that actually reaches a
patient, and it is invisible to any metric that only counts hits.

**CER / WER** on the full-page text, over labels carrying a ``raw_text``
transcription. This separates *recognition* failure from *matching* failure: if
CER is 0.6, no amount of dictionary work will help — which is the argument for
Phase 1.

**Strength and frequency accuracy**, scored only on correctly identified drugs —
you cannot credit a dose on a drug you got wrong. Frequency is compared as
doses-per-day so ``0-0-1``, ``OD`` and ``once daily`` are one value.

Items a transcriber marked ``certain: false`` are held out of the headline rather
than silently inflating or deflating it: an uncertain *medicine* is excluded from
both precision and recall (a prediction landing on it is neither credited nor
punished), and an uncertain *page* is scored and reported separately.

OCR costs ~26s per image and each call spins up the multi-engine torch ensemble,
so images are scored strictly serially — running them concurrently saturates the
CPU badly enough that the whole run appears to hang.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from rapidfuzz import fuzz
from rapidfuzz.distance import Levenshtein

from backend.config import ROOT_DIR
from backend.ocr.medicine_intelligence import normalize as normalize_name

LABEL_DIR = ROOT_DIR / "datasets" / "prescriptions" / "labels"
REPORT_DIR = ROOT_DIR / "docs" / "benchmarks"

#: Whole-string agreement (0-100) at which two drug names are the same drug.
#: Deliberately ``fuzz.ratio`` and NOT ``WRatio``/``partial_ratio``: the substring
#: tolerance of WRatio is precisely the defect this benchmark exists to measure,
#: so scoring with it would hide the bug it is meant to expose. Tunable with
#: ``--name-tolerance``.
NAME_MATCH_FLOOR = 88.0

#: Splits reported separately. Handwriting is the hard case and the reason the
#: overhaul exists, so one blended number would hide the thing under test.
SPLITS = ("handwritten", "printed", "mixed")


# ==========================================================================
# Labels
# ==========================================================================
@dataclass
class GoldMedicine:
    name: str
    strength: str | None = None
    form: str | None = None
    frequency: str | None = None
    duration: str | None = None
    certain: bool = True


@dataclass
class Label:
    image: str
    image_path: Path
    split: str
    source: str
    certain: bool
    raw_text: str | None
    medicines: list[GoldMedicine]
    label_file: Path


def _text(value: Any) -> str | None:
    if value is None:
        return None
    return str(value).strip() or None


def load_label(path: Path) -> Label | None:
    """Parse one label file. Returns ``None`` for JSON that is not a label."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise ValueError(f"{path.name}: not valid JSON ({exc})") from exc
    if not isinstance(data, dict) or "medicines" not in data:
        return None

    image = _text(data.get("image")) or f"{path.stem}.jpg"
    image_path = Path(_text(data.get("image_path")) or image)
    if not image_path.is_absolute():
        image_path = ROOT_DIR / image_path

    split = (_text(data.get("split")) or "unknown").lower()
    medicines = [
        GoldMedicine(
            name=_text(m.get("name")) or "",
            strength=_text(m.get("strength")),
            form=_text(m.get("form")),
            frequency=_text(m.get("frequency")),
            duration=_text(m.get("duration")),
            certain=bool(m.get("certain", True)),
        )
        for m in data.get("medicines") or []
    ]
    return Label(
        image=image,
        image_path=image_path,
        split=split if split in SPLITS else "unknown",
        source=_text(data.get("source")) or "unknown",
        certain=bool(data.get("certain", True)),
        raw_text=_text(data.get("raw_text")),
        medicines=[m for m in medicines if m.name],
        label_file=path,
    )


def load_labels(label_dir: Path = LABEL_DIR, split: str | None = None) -> list[Label]:
    if not label_dir.is_dir():
        raise FileNotFoundError(
            f"No labels directory at {label_dir}. Ground truth is Phase 0's blocking "
            "deliverable — see datasets/prescriptions/labels/README.md."
        )
    labels = [lb for p in sorted(label_dir.glob("*.json")) if (lb := load_label(p))]
    if split:
        labels = [lb for lb in labels if lb.split == split]
    if not labels:
        raise FileNotFoundError(
            f"No labels in {label_dir}"
            + (f" for split {split!r}" if split else "")
            + ". The benchmark is only meaningful with hand-labelled ground truth."
        )
    return labels


# ==========================================================================
# Normalisation used by the comparisons
# ==========================================================================
def _collapse(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().lower()


_STRENGTH_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(mcg|mg|gm|g|ml|iu|%|units?)\b", re.I)
_UNIT_CANON = {"gm": "g", "unit": "iu", "units": "iu"}

_SLOT_RE = re.compile(
    r"^(\d+(?:\.\d+)?|½|¼)\s*"
    r"(?:ml|mg|mcg|gm?|drops?|tabs?|tablets?|caps?|capsules?|puffs?|tsp)?$",
    re.I,
)
_FRACTIONS = {"½": 0.5, "¼": 0.25}

#: Sig codes and plain-English frequencies collapsed to doses per day.
_DOSES_PER_DAY = {
    "od": 1, "qd": 1, "om": 1, "on": 1, "hs": 1, "qhs": 1, "q24h": 1,
    "oncedaily": 1, "onceaday": 1, "daily": 1, "once": 1,
    "bd": 2, "bid": 2, "twicedaily": 2, "twiceaday": 2, "q12h": 2,
    "tds": 3, "tid": 3, "threetimesdaily": 3, "threetimesaday": 3, "q8h": 3,
    "qds": 4, "qid": 4, "fourtimesdaily": 4, "fourtimesaday": 4, "q6h": 4,
    "q4h": 6,
}
_AS_NEEDED = {"prn", "sos", "asneeded", "asrequired", "whenrequired"}


def normalize_strength(value: str | None) -> str | None:
    """``"10 MG"`` / ``"10mg"`` -> ``"10mg"``; unparseable text -> compacted text."""
    if not value:
        return None
    m = _STRENGTH_RE.search(value)
    if not m:
        return re.sub(r"[^a-z0-9.]", "", value.lower()) or None
    unit = m.group(2).lower()
    return f"{float(m.group(1)):g}{_UNIT_CANON.get(unit, unit)}"


def _schedule_doses(value: str) -> int | None:
    """Doses/day for a slot schedule (``0-0-1``, ``0.3ml-0.3ml-0.3ml``)."""
    parts = [p.strip() for p in re.split(r"[-–—]", value) if p.strip()]
    if len(parts) < 2:
        return None
    active = 0
    for part in parts:
        m = _SLOT_RE.match(part)
        if not m:
            return None
        token = m.group(1)
        if (_FRACTIONS.get(token) or float(token)) > 0:
            active += 1
    return active


def normalize_frequency(value: str | None) -> str | None:
    """Collapse a frequency to doses/day so notations compare as one value.

    ``0-0-1`` == ``OD`` == ``once daily`` == ``1x/day``. Anything that does not
    parse falls back to a compacted string, so the comparison stays strict rather
    than quietly accepting whatever it was given.
    """
    if not value:
        return None
    text = _collapse(value)
    doses = _schedule_doses(text)
    if doses is not None:
        return f"{doses}x/day"
    key = re.sub(r"[^a-z0-9]", "", text)
    if key in _DOSES_PER_DAY:
        return f"{_DOSES_PER_DAY[key]}x/day"
    if key in _AS_NEEDED:
        return "prn"
    return key or None


def name_agreement(gold: str, predicted: str) -> tuple[float, str]:
    """Return ``(0-100 agreement, rule)`` for two drug names.

    Normalisation is imported from the pipeline's own
    :func:`~backend.ocr.medicine_intelligence.normalize`, so form words and
    strengths are stripped exactly as the matcher under test strips them — a
    second implementation here would let the benchmark and the pipeline drift
    apart and score the difference as accuracy.

    Three rules, in order, and the one that fired is recorded per pair in the
    JSON report:

    ``exact``
        Normalised forms are equal — ``Advent`` vs the dictionary's
        ``advent drops``.
    ``prefix``
        One token list starts the other — ``Nanoclear`` vs ``nanoclear nasal``.
        This is what makes a brand match its full dictionary display name, and it
        is also the rule's weak point: it will accept a brand-line extension
        (``Advent`` vs ``Advent Plus``) as the same drug. That is why the rule is
        recorded rather than hidden — those pairs are auditable in the report.
    ``ratio``
        Whole-string ``fuzz.ratio``, for spelling drift.
    """
    g, p = normalize_name(gold), normalize_name(predicted)
    if not g or not p:
        return 0.0, "empty"
    if g == p:
        return 100.0, "exact"
    gt, pt = g.split(), p.split()
    if gt[: len(pt)] == pt or pt[: len(gt)] == gt:
        return 95.0, "prefix"
    return float(fuzz.ratio(g, p)), "ratio"


# ==========================================================================
# Text recognition metrics
# ==========================================================================
def cer(reference: str, hypothesis: str) -> float | None:
    """Character error rate. ``None`` when there is no reference to score."""
    ref, hyp = _collapse(reference), _collapse(hypothesis)
    if not ref:
        return None
    return Levenshtein.distance(ref, hyp) / len(ref)


def wer(reference: str, hypothesis: str) -> float | None:
    """Word error rate. ``None`` when there is no reference to score."""
    ref, hyp = _collapse(reference).split(), _collapse(hypothesis).split()
    if not ref:
        return None
    return Levenshtein.distance(ref, hyp) / len(ref)


# ==========================================================================
# Scoring one prescription
# ==========================================================================
@dataclass
class Pairing:
    gold: str
    predicted: str
    agreement: float
    rule: str


@dataclass
class ImageScore:
    image: str
    split: str
    certain: bool = True
    status: str = "scored"              # scored | missing-image | failed
    error: str = ""

    gold_certain: int = 0
    gold_uncertain: int = 0
    claimed: int = 0                    # rows the pipeline resolved to a name
    unresolved: int = 0                 # rows surfaced for review, unnamed

    true_positives: int = 0
    false_positives: int = 0
    false_negatives: int = 0
    matched_uncertain: int = 0          # claims that landed on an uncertain gold item

    cer: float | None = None
    wer: float | None = None

    strength_expected: int = 0
    strength_correct: int = 0
    strength_invented: int = 0          # label records none, pipeline supplied one
    frequency_expected: int = 0
    frequency_correct: int = 0
    frequency_invented: int = 0

    seconds: float = 0.0
    engine: str | None = None
    provider: str | None = None
    invented: list[str] = field(default_factory=list)
    missed: list[str] = field(default_factory=list)
    pairs: list[Pairing] = field(default_factory=list)


def assign(
    gold: list[GoldMedicine],
    claims: list[Any],
    floor: float = NAME_MATCH_FLOOR,
) -> tuple[list[tuple[int, int, float, str]], set[int], set[int]]:
    """Best-first one-to-one assignment of claims to gold medicines.

    Returns ``(pairs, matched_gold, matched_claims)`` where each pair is
    ``(gold_index, claim_index, agreement, rule)``. Best-first rather than
    first-fit so that when two names on a page are similar, each is taken by its
    closest counterpart instead of by whichever gold row is listed first.
    """
    scored: list[tuple[float, str, int, int]] = []
    for gi, g in enumerate(gold):
        for ci, c in enumerate(claims):
            agreement, rule = name_agreement(g.name, c.name or "")
            if agreement >= floor:
                scored.append((agreement, rule, gi, ci))
    scored.sort(key=lambda s: (-s[0], s[2], s[3]))

    pairs: list[tuple[int, int, float, str]] = []
    used_gold: set[int] = set()
    used_claims: set[int] = set()
    for agreement, rule, gi, ci in scored:
        if gi in used_gold or ci in used_claims:
            continue
        used_gold.add(gi)
        used_claims.add(ci)
        pairs.append((gi, ci, agreement, rule))
    return pairs, used_gold, used_claims


def score_image(label: Label, result: Any, floor: float = NAME_MATCH_FLOOR) -> ImageScore:
    """Score one ``PrescriptionResult`` against its label.

    Takes the result rather than producing it, so the scoring is testable without
    running a 26-second OCR pass.
    """
    s = ImageScore(image=label.image, split=label.split, certain=label.certain)
    s.provider = getattr(result, "provider", None)
    s.engine = getattr(result, "best_engine", None)

    # A named row is a claim; an unnamed row is an explicit "please check this".
    # Only claims can be right or wrong, so only claims are scored.
    claims = [m for m in result.medicines if m.name and not m.needs_review]
    s.claimed = len(claims)
    s.unresolved = len(result.medicines) - len(claims)

    gold = label.medicines
    s.gold_certain = sum(1 for g in gold if g.certain)
    s.gold_uncertain = len(gold) - s.gold_certain

    pairs, matched_gold, matched_claims = assign(gold, claims, floor)

    for gi, ci, agreement, rule in pairs:
        g, p = gold[gi], claims[ci]
        if not g.certain:
            # The transcriber could not read this name confidently, so a
            # prediction landing on it can be neither credited nor punished.
            s.matched_uncertain += 1
            continue

        s.true_positives += 1
        s.pairs.append(
            Pairing(gold=g.name, predicted=p.name, agreement=round(agreement, 1), rule=rule)
        )

        gold_strength = normalize_strength(g.strength)
        pred_strength = normalize_strength(p.dosage)
        if gold_strength:
            s.strength_expected += 1
            s.strength_correct += pred_strength == gold_strength
        elif pred_strength:
            s.strength_invented += 1

        gold_frequency = normalize_frequency(g.frequency)
        pred_frequency = normalize_frequency(p.frequency)
        if gold_frequency:
            s.frequency_expected += 1
            s.frequency_correct += pred_frequency == gold_frequency
        elif pred_frequency:
            s.frequency_invented += 1

    for gi, g in enumerate(gold):
        if g.certain and gi not in matched_gold:
            s.false_negatives += 1
            s.missed.append(g.name)
    for ci, c in enumerate(claims):
        if ci not in matched_claims:
            s.false_positives += 1
            s.invented.append(c.name)

    if label.raw_text:
        s.cer = cer(label.raw_text, result.raw_text or "")
        s.wer = wer(label.raw_text, result.raw_text or "")
    return s


# ==========================================================================
# Aggregation
# ==========================================================================
def _ratio(numerator: float, denominator: float) -> float:
    return round(numerator / denominator, 4) if denominator else 0.0


def _mean(values: list[float]) -> float | None:
    return round(sum(values) / len(values), 4) if values else None


def aggregate(scores: list[ImageScore]) -> dict[str, Any]:
    """Roll per-image scores into the numbers the scorecard reports."""
    ok = [s for s in scores if s.status == "scored"]
    tp = sum(s.true_positives for s in ok)
    fp = sum(s.false_positives for s in ok)
    fn = sum(s.false_negatives for s in ok)
    precision, recall = _ratio(tp, tp + fp), _ratio(tp, tp + fn)

    cers = [s.cer for s in ok if s.cer is not None]
    wers = [s.wer for s in ok if s.wer is not None]
    strength_expected = sum(s.strength_expected for s in ok)
    frequency_expected = sum(s.frequency_expected for s in ok)

    return {
        "prescriptions": len(ok),
        "gold_medicines": sum(s.gold_certain for s in ok),
        "true_positives": tp,
        "false_positives": fp,
        "false_negatives": fn,
        "precision": precision,
        "recall": recall,
        "f1": _ratio(2 * precision * recall, precision + recall),
        # The number the old metric could never produce: how often the system
        # names a drug that is not on the page.
        "false_positives_per_prescription": _ratio(fp, len(ok)),
        "unresolved_per_prescription": _ratio(sum(s.unresolved for s in ok), len(ok)),
        "claims_per_prescription": _ratio(sum(s.claimed for s in ok), len(ok)),
        "matched_uncertain": sum(s.matched_uncertain for s in ok),
        "cer": _mean(cers),
        "wer": _mean(wers),
        "text_coverage": f"{len(cers)}/{len(ok)}",
        "strength_expected": strength_expected,
        "strength_accuracy": _ratio(sum(s.strength_correct for s in ok), strength_expected),
        "strength_invented": sum(s.strength_invented for s in ok),
        "frequency_expected": frequency_expected,
        "frequency_accuracy": _ratio(sum(s.frequency_correct for s in ok), frequency_expected),
        "frequency_invented": sum(s.frequency_invented for s in ok),
        "seconds_per_image": _mean([s.seconds for s in ok]) or 0.0,
    }


def build_report(
    scores: list[ImageScore],
    *,
    provider: str | None,
    floor: float,
    preprocess: bool,
    label_dir: Path,
    labels_found: int,
) -> dict[str, Any]:
    headline = [s for s in scores if s.certain]
    held_out = [s for s in scores if not s.certain]
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "run": {
            "provider_requested": provider or "auto",
            "engine": next((s.engine for s in scores if s.engine), None),
            "preprocess": preprocess,
            "name_tolerance": floor,
            "label_dir": str(label_dir.relative_to(ROOT_DIR)),
            "labels_found": labels_found,
            "images_missing": sum(1 for s in scores if s.status == "missing-image"),
            "images_failed": sum(1 for s in scores if s.status == "failed"),
            "pages_held_out": len(held_out),
        },
        "overall": aggregate(headline),
        "by_split": {
            split: aggregate([s for s in headline if s.split == split])
            for split in SPLITS
            if any(s.split == split for s in headline)
        },
        "held_out_pages": aggregate(held_out) if held_out else None,
        "images": [
            {
                "image": s.image,
                "split": s.split,
                "status": s.status,
                "certain": s.certain,
                "error": s.error,
                "gold": s.gold_certain,
                "gold_uncertain": s.gold_uncertain,
                "claimed": s.claimed,
                "unresolved": s.unresolved,
                "tp": s.true_positives,
                "fp": s.false_positives,
                "fn": s.false_negatives,
                "matched_uncertain": s.matched_uncertain,
                "cer": None if s.cer is None else round(s.cer, 4),
                "wer": None if s.wer is None else round(s.wer, 4),
                "invented": s.invented,
                "missed": s.missed,
                "matched": [
                    {"gold": p.gold, "predicted": p.predicted,
                     "agreement": p.agreement, "rule": p.rule}
                    for p in s.pairs
                ],
                "engine": s.engine,
                "seconds": round(s.seconds, 2),
            }
            for s in scores
        ],
    }


# ==========================================================================
# Rendering
# ==========================================================================
def _fmt(value: float | None, digits: int = 3) -> str:
    return "—" if value is None else f"{value:.{digits}f}"


def _pct(value: float | None) -> str:
    return "—" if value is None else f"{value * 100:.1f}%"


def _row(name: str, m: dict[str, Any]) -> str:
    return (
        f"| {name} | {m['prescriptions']} | {m['gold_medicines']} | "
        f"{_fmt(m['precision'])} | {_fmt(m['recall'])} | {_fmt(m['f1'])} | "
        f"{_fmt(m['false_positives_per_prescription'], 2)} | "
        f"{m['true_positives']}/{m['false_positives']}/{m['false_negatives']} |"
    )


def render_markdown(report: dict[str, Any]) -> str:
    run, overall = report["run"], report["overall"]
    lines = [
        "# Prescription pipeline scorecard",
        "",
        f"Generated {report['generated_at']} · provider `{run['provider_requested']}` "
        f"· engine `{run['engine'] or 'n/a'}` "
        f"· preprocessing {'on' if run['preprocess'] else 'off'}",
        "",
        f"Scored **{overall['prescriptions']}** labelled prescriptions "
        f"({overall['gold_medicines']} ground-truth medicines) from "
        f"`{run['label_dir']}`.",
        "",
    ]

    notes = []
    if run["images_missing"]:
        notes.append(f"{run['images_missing']} label(s) point at a missing image")
    if run["images_failed"]:
        notes.append(f"{run['images_failed']} image(s) failed to process")
    if run["pages_held_out"]:
        notes.append(
            f"{run['pages_held_out']} page(s) marked `certain: false` are reported "
            "separately, not in the headline"
        )
    if notes:
        lines += ["> " + "; ".join(notes) + ".", ""]

    if overall["prescriptions"] < 100:
        lines += [
            "> **Provisional.** The plan calls for ≥100 labelled prescriptions "
            f"(60 handwritten / 25 printed / 15 mixed); {overall['prescriptions']} "
            "are scored here. These numbers are directional until the set is complete.",
            "",
        ]

    lines += [
        "## Medicine identity",
        "",
        "| Split | Rx | Gold | Precision | Recall | F1 | FP/Rx | TP/FP/FN |",
        "|---|---:|---:|---:|---:|---:|---:|---:|",
        _row("**All**", overall),
    ]
    lines += [_row(split, m) for split, m in report["by_split"].items()]
    lines += [
        "",
        f"**False positives per prescription: "
        f"{overall['false_positives_per_prescription']:.2f}** — drugs named that are "
        "not on the page. Phase 1's exit criterion is < 0.5.",
        "",
        f"Per prescription the pipeline made {overall['claims_per_prescription']:.2f} "
        f"named claims and left {overall['unresolved_per_prescription']:.2f} rows "
        "unresolved. Unresolved rows cost recall but are honest — they are surfaced "
        "for review, never presented as an identified drug.",
        "",
        "## Text recognition",
        "",
        "| Metric | Value |",
        "|---|---:|",
        f"| CER (character error rate) | {_fmt(overall['cer'])} |",
        f"| WER (word error rate) | {_fmt(overall['wer'])} |",
        f"| Labels carrying a transcription | {overall['text_coverage']} |",
        "",
        "## Field extraction (on correctly identified drugs only)",
        "",
        "| Field | Expected | Correct | Invented |",
        "|---|---:|---:|---:|",
        f"| Strength | {overall['strength_expected']} | "
        f"{_pct(overall['strength_accuracy'])} | {overall['strength_invented']} |",
        f"| Frequency | {overall['frequency_expected']} | "
        f"{_pct(overall['frequency_accuracy'])} | {overall['frequency_invented']} |",
        "",
        '"Invented" = the label records no value for that field, but the pipeline '
        "supplied one.",
        "",
        "## Per prescription",
        "",
        "| Image | Split | Gold | Named | Unresolved | TP | FP | FN | CER | Named in error |",
        "|---|---|---:|---:|---:|---:|---:|---:|---:|---|",
    ]
    for img in report["images"]:
        if img["status"] != "scored":
            lines.append(
                f"| {img['image']} | {img['split']} | — | — | — | — | — | — | — | "
                f"_{img['status']}: {img['error']}_ |"
            )
            continue
        lines.append(
            f"| {img['image']} | {img['split']} | {img['gold']} | {img['claimed']} | "
            f"{img['unresolved']} | {img['tp']} | {img['fp']} | {img['fn']} | "
            f"{_fmt(img['cer'], 2)} | {', '.join(img['invented']) or '—'} |"
        )

    missed = [m for img in report["images"] for m in img["missed"]]
    if missed:
        lines += ["", f"**Missed ({len(missed)}):** " + ", ".join(missed)]

    if report.get("held_out_pages"):
        lines += [
            "",
            "## Pages held out of the headline (`certain: false`)",
            "",
            "| Split | Rx | Gold | Precision | Recall | F1 | FP/Rx | TP/FP/FN |",
            "|---|---:|---:|---:|---:|---:|---:|---:|",
            _row("held out", report["held_out_pages"]),
        ]

    lines += [
        "",
        "---",
        "",
        "## How to read this",
        "",
        "* A **claim** is a row the pipeline resolved to a name. Unnamed rows are "
        "flagged for review, cost recall, and are never counted as false positives — "
        "scoring them as errors would reward dropping a doubtful row over surfacing it.",
        f"* Two names are the same drug when their normalised forms are equal, when "
        f"one token list starts the other, or at ≥ {run['name_tolerance']:.0f}/100 "
        "whole-string agreement. Every pair records which rule fired, in the JSON "
        "alongside this file.",
        "* Medicines a transcriber marked `certain: false` are excluded from both "
        f"precision and recall ({overall['matched_uncertain']} prediction(s) landed "
        "on one here).",
        "* Generated by `make bench` (`python -m backend.ocr.benchmark`). See "
        "`docs/PRESCRIPTION_OCR_OVERHAUL.md` §3 Phase 0.",
        "",
    ]
    return "\n".join(lines)


def render_console(report: dict[str, Any]) -> str:
    overall = report["overall"]
    out = ["", "=" * 78, "PRESCRIPTION PIPELINE BENCHMARK", "=" * 78, ""]
    out.append(f"{'image':<28}{'split':<13}{'gold':>5}{'named':>7}{'TP':>4}{'FP':>4}{'FN':>4}{'sec':>7}")
    out.append("-" * 78)
    for img in report["images"]:
        if img["status"] != "scored":
            out.append(f"{img['image'][:27]:<28}{img['split']:<13}  {img['status'].upper()}  {img['error'][:24]}")
            continue
        out.append(
            f"{img['image'][:27]:<28}{img['split']:<13}{img['gold']:>5}"
            f"{img['claimed']:>7}{img['tp']:>4}{img['fp']:>4}{img['fn']:>4}"
            f"{img['seconds']:>7.1f}"
        )
    out += ["", "-" * 78, "AGGREGATE (certain pages only)", "-" * 78]
    out.append(f"  prescriptions scored       {overall['prescriptions']}")
    out.append(f"  ground-truth medicines     {overall['gold_medicines']}")
    out.append("")
    out.append(
        f"  precision {overall['precision']:.3f}   recall {overall['recall']:.3f}"
        f"   F1 {overall['f1']:.3f}"
    )
    out.append(f"  false positives / Rx       {overall['false_positives_per_prescription']:.2f}")
    out.append(f"  unresolved rows / Rx       {overall['unresolved_per_prescription']:.2f}")
    out.append(
        f"  CER {_fmt(overall['cer'])}   WER {_fmt(overall['wer'])}"
        f"   (coverage {overall['text_coverage']})"
    )
    out.append(
        f"  strength {_pct(overall['strength_accuracy'])} of {overall['strength_expected']}"
        f"   frequency {_pct(overall['frequency_accuracy'])} of {overall['frequency_expected']}"
    )
    out.append(f"  seconds / image            {overall['seconds_per_image']:.1f}")
    missed = [m for img in report["images"] for m in img["missed"]]
    invented = [i for img in report["images"] for i in img["invented"]]
    if missed:
        out += ["", f"  MISSED ({len(missed)}): " + ", ".join(missed[:12])]
    if invented:
        out.append(f"  INVENTED ({len(invented)}): " + ", ".join(invented[:12]))
    out.append("")
    return "\n".join(out)


# ==========================================================================
# Runner
# ==========================================================================
def run_benchmark(
    label_dir: Path = LABEL_DIR,
    *,
    split: str | None = None,
    provider: str | None = None,
    preprocess: bool = True,
    floor: float = NAME_MATCH_FLOOR,
    limit: int | None = None,
    progress: bool = True,
) -> dict[str, Any]:
    """Run every labelled image through the pipeline and score the results.

    Images are processed **one at a time on purpose** — see the module docstring.
    """
    # Imported here rather than at module scope so the scoring functions above can
    # be imported (and tested) without loading torch and the 248k-row index.
    from backend.ocr.pipeline import run_pipeline

    labels = load_labels(label_dir, split)
    labels_found = len(labels)
    if limit:
        labels = labels[:limit]

    scores: list[ImageScore] = []
    for i, label in enumerate(labels, 1):
        if progress:
            print(f"[{i}/{len(labels)}] {label.image} ({label.split})", flush=True)

        if not label.image_path.exists():
            scores.append(
                ImageScore(
                    image=label.image, split=label.split, certain=label.certain,
                    status="missing-image", error=f"no file at {label.image_path}",
                )
            )
            if progress:
                print(f"    ! image not found: {label.image_path}", flush=True)
            continue

        start = time.perf_counter()
        try:
            result = run_pipeline(
                str(label.image_path), provider_name=provider, preprocess=preprocess
            )
        except Exception as exc:  # noqa: BLE001 — one bad image must not abort a run
            scores.append(
                ImageScore(
                    image=label.image, split=label.split, certain=label.certain,
                    status="failed", error=f"{type(exc).__name__}: {exc}",
                    seconds=time.perf_counter() - start,
                )
            )
            if progress:
                print(f"    ! failed: {exc}", flush=True)
            continue

        score = score_image(label, result, floor)
        score.seconds = time.perf_counter() - start
        scores.append(score)
        if progress:
            print(
                f"    tp={score.true_positives} fp={score.false_positives} "
                f"fn={score.false_negatives} unresolved={score.unresolved} "
                f"({score.seconds:.1f}s)",
                flush=True,
            )

    return build_report(
        scores,
        provider=provider,
        floor=floor,
        preprocess=preprocess,
        label_dir=label_dir,
        labels_found=labels_found,
    )


def write_report(report: dict[str, Any], out_dir: Path, tag: str | None) -> tuple[Path, Path]:
    """Write the timestamped markdown + JSON pair and refresh ``latest.md``."""
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    suffix = f"-{re.sub(r'[^a-z0-9-]+', '-', tag.lower()).strip('-')}" if tag else ""
    base = out_dir / f"{stamp}{suffix}"

    md_path, json_path = base.with_suffix(".md"), base.with_suffix(".json")
    md_path.write_text(render_markdown(report), encoding="utf-8")
    json_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    shutil.copyfile(md_path, out_dir / "latest.md")
    return md_path, json_path


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        prog="python -m backend.ocr.benchmark",
        description="Score the prescription pipeline against ground-truth labels.",
    )
    ap.add_argument("--labels", type=Path, default=LABEL_DIR,
                    help=f"label directory (default: {LABEL_DIR.relative_to(ROOT_DIR)})")
    ap.add_argument("--split", choices=SPLITS, help="score only this split")
    ap.add_argument("--provider",
                    help="force an OCR provider (gemini/openai/google_vision/local)")
    ap.add_argument("--no-preprocess", action="store_true", help="skip image preprocessing")
    ap.add_argument("--limit", type=int, help="score only the first N labels")
    ap.add_argument("--name-tolerance", type=float, default=NAME_MATCH_FLOOR,
                    help=f"whole-string name agreement floor (default: {NAME_MATCH_FLOOR:.0f})")
    ap.add_argument("--out", type=Path, default=REPORT_DIR,
                    help=f"report directory (default: {REPORT_DIR.relative_to(ROOT_DIR)})")
    ap.add_argument("--tag", help="label the report file, e.g. --tag gemini")
    ap.add_argument("--quiet", action="store_true", help="suppress per-image progress")
    args = ap.parse_args(argv)

    report = run_benchmark(
        args.labels,
        split=args.split,
        provider=args.provider,
        preprocess=not args.no_preprocess,
        floor=args.name_tolerance,
        limit=args.limit,
        progress=not args.quiet,
    )
    print(render_console(report))

    md_path, json_path = write_report(report, args.out, args.tag)
    print(f"  report -> {md_path.relative_to(ROOT_DIR)}")
    print(f"            {json_path.relative_to(ROOT_DIR)}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
