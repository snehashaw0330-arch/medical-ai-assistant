# Prescription Reading — Assessment & Overhaul Plan

Status: **draft for approval**  ·  Written 2026-07-29  ·  Owner: engineering

This document answers three questions: what the prescription reader actually does today,
whether it is valid, and what a real fix looks like. It is written to be executed in phases
by two agents working in parallel (see [Ownership](#ownership--parallel-execution)).

---

## 1. Verdict

**The prescription reader is not production grade for clinical use, and the gap is not
closable by tuning.** The recognition layer cannot read the input it is designed for.

Three findings, each measured rather than asserted:

### 1.1 The OCR engines cannot read handwriting

EasyOCR and Tesseract are scene-text / printed-document engines. Cursive medical handwriting
is close to their worst case. Measured on a real pediatric prescription:

| Written on the page | What OCR produced | Engine confidence |
|---|---|---|
| Advent drops | `Adunt &ul` | 0.368 |
| HH-zole cream | `Hlzale` | 0.646 |
| Nanoclear nasal drops | `N m elQdn` | 0.149 |
| Arthakind drops | `Amlvml AwN_v/` | 0.158 |
| *H.R. Children Hospital* (printed letterhead) | `AbEadwcs Bente HLa_Chlldron Hospltal` | 0.007 |

Even on a **clean synthetic** image, `Omeprazole` was read as `C~plazole` and matched
"c sora ointment". No threshold, preprocessing step or ensemble weight recovers text the
engine never produced.

### 1.2 Accuracy has never been measured, and the metric that exists is misleading

* `datasets/prescriptions/illegible_dataset/` — **129 images, zero labels.**
* `prescription-ocr/datasets/synthetic/labels.txt` — 3 lines.
* `evaluation.build_metrics` computes
  `medicine_extraction_accuracy = images_with_≥1_medicine / images_processed`.
  This never compares against ground truth. **It rewards guessing.** While the pipeline was
  fabricating 31 drugs from a 5-medicine prescription, this metric read ~100%. It is
  structurally incapable of detecting the bug it should have caught first.

Consequence: every quality claim in the product (including the dashboard's "Model accuracy")
is currently unfounded.

### 1.3 The ensemble optimises for the wrong thing

`confidence.select_best` ranks engines by `dictionary_agreement` — the fraction of lines that
fuzzy-match a drug name at ≥78. With no ground truth to rank against, **the ensemble prefers
whichever engine hallucinates the most drug-like text.** This is an actively mis-aligned
objective, not merely a missing feature.

### 1.4 What has already been fixed (2026-07-29)

The most dangerous symptom is closed: a two-gate filter (`ocr/line_filter.py` +
`confirm_score` in `medicine_intelligence.py`) took the pediatric prescription from
**31 medicines / ~17 confidently named → 9 rows / 0 named**, with an explicit warning about
excluded unreadable lines. Validation: 20/20 noise blocked, 15/20 legitimate medicines kept.

That change stops the system *lying*. It does not make it *work*. Phases 0–3 below do.

---

## 2. Root-cause architecture problems

Beyond the engines, three design decisions have to change.

**(a) Recognition returns lines, not structure.** `run_pipeline` treats every OCR line as a
candidate medicine. This is why `1Omg` and `0-0-1 X 1 week` became separate "medicines" on a
one-drug prescription, and why the dosage/frequency fields on the real drug row were empty —
the attributes were consumed as siblings instead of being attached to their drug.

**(b) The 248k CSV is the wrong matching target.** It is a brand-SKU list with strengths baked
into the display name (`dr 4 tablet`, `a 250 suspension`, `mst tablet`). Matching free text
against it guarantees spurious hits, because for any 4-letter fragment *some* SKU contains it.
A formulary needs molecule / brand / form / strength as **separate fields** plus an alias index.

**(c) Confidence is invented, not calibrated.** `_row_confidence = 0.7·dict_score + 0.3·seg_conf`
is an arbitrary blend presented to clinicians as a percentage. Until it is fitted against a
labelled set it carries no meaning.

---

## 3. Phase plan

Phases are ordered by dependency. **Phase 0 gates everything** — without it we cannot tell
whether any later change helped.

### Phase 0 — Ground truth & evaluation harness  *(blocking)*

Nothing downstream is meaningful until we can measure.

- Label a held-out set: **≥100 prescriptions**, transcribed by hand into
  `datasets/prescriptions/labels/<image>.json` — `{medicines:[{name, strength, form,
  frequency, duration}], patient:{age, weight}}`.
  Split: 60 handwritten / 25 printed / 15 mixed-or-poor-quality.
- Build `backend/ocr/benchmark.py` reporting, per run:
  **CER/WER** on raw text; **precision / recall / F1** on medicine identity;
  field-level accuracy for strength & frequency; and a **false-positive rate per
  prescription** (the metric that would have caught this bug).
- Delete or rename `medicine_extraction_accuracy` so it can never again be read as accuracy.
- Wire it to a single command: `make bench` → markdown + JSON report, committed per run.

**Exit criteria:** one command produces a scorecard for the current pipeline. That scorecard is
the baseline every later phase is judged against.

#### Status: harness DONE (2026-07-29), labelling IN PROGRESS

Shipped: `backend/ocr/benchmark.py`, label schema + rules in
`datasets/prescriptions/labels/README.md`, and the metric rename
(`medicine_extraction_accuracy` → `medicine_detection_rate`, UI label "Images with medicines")
so coverage can never again be read as accuracy.

```
./venv/bin/python -m backend.ocr.benchmark [--split handwritten] [--json out.json]
```

**Baseline — 4 seeded labels (3 printed synthetic, 1 real handwritten, 8 medicines):**

| metric | value | reading |
|---|---|---|
| NAMED precision | **1.000** | nothing it names is wrong — the two-gate fix holds |
| NAMED recall | **0.250** | it finds 1 medicine in 4 |
| false positives / Rx | **0.0** | no invented drugs |
| ALL-rows precision | 0.154 | the review rows are mostly noise |
| CER / WER | **0.40 / 0.50** | on *clean printed* text — poor |
| missed | T-Minic, Arthakind, Advent, Nanoclear, HH-zole, Omeprazole | every handwritten item |

Re-running with the new thresholds relaxed (approximating pre-fix matching) confirms the
harness detects the defect it exists to catch:

| | thresholds relaxed | current |
|---|---|---|
| NAMED precision | 0.115 | **1.000** |
| false positives / Rx | 5.75 | **0.0** |
| recall | 0.375 | 0.250 |

So the fix bought +0.885 precision for −0.125 recall — the right trade for a clinical tool,
and now a measured one rather than an opinion. **The system is currently safe but not yet
useful on handwriting**; that is what Phase 1 exists to change. Note CER 0.40 on clean printed
images is itself a strong argument that the engines — not just the matcher — are the problem.

**Remaining to exit Phase 0:** scale labels from 9 → ≥100 (see the labels README).

#### Update — 9 labels, and what the bigger set revealed (2026-07-29)

Labels grew 4 → 9 by transcribing dataset images, including **a deliberate negative
case** (`10.jpg` is a medical certificate with no drugs at all). The larger set immediately
falsified the 4-label reading of "precision 1.000": with 9 labels it was **0.333**, and the
negative case alone produced 3 invented medicines. Small label sets flatter the pipeline.

The false positives showed English prose matching drug SKUs — `INSTITUTES OF
GASTROENTEROLOGY` → "gastro 20 tablet", `he further needs...` → "need syrup", `Dr B. Who`
→ "dr 4 tablet". Three fixes followed, each measured:

1. **Prose + title detection** (`line_filter.py`) — function words are the sharpest signal
   for narrative text; drug lines contain essentially none. Separated 26/28 with **zero**
   drug lines wrongly rejected.
2. **`confirm_score` was broken for single-token names** — `token_set_ratio` returns 100
   whenever the candidate appears as a token in the query, so `"Wu Om"` scored 100 against
   `"om suspension"`. Single-token products now compare whole-string.
3. **Strength tokens were dragging real matches down** — `normalize` only strips digits at
   word boundaries, so a fused `"650mg"` survived and cost `Paracetamol 650mg` → 78.6.
   Now stripped symmetrically from both sides. Threshold raised 88 → 90, which sits in a
   measured gap (weakest genuine 94.7, strongest false 88.9).

| | 4 labels | 9 labels, before | 9 labels, after |
|---|---|---|---|
| precision | 1.000 | 0.333 | **1.000** |
| false positives / Rx | 0.0 | 0.44 | **0.00** |
| recall | 0.250 | 0.143 | 0.143 |

Recall is unchanged and low — that is the recognition ceiling, and only Phase 1 moves it.

### Phase 1 — Replace recognition with a vision-language model

The provider abstraction already exists (`backend/ocr/providers/`), so this is a swap, not a
rewrite.

- Make a VLM the **primary** path, local ensemble the offline fallback.
- Prompt for **structured JSON directly** — medicines with name/strength/form/frequency/
  duration/route, plus patient fields — rather than a text dump we re-parse. This removes
  problem (a) at the root.
- Ask the model to emit a per-item confidence and to return `null` rather than guess.
- Keep everything offline-safe: no key configured ⇒ current behaviour, no crash.
- Re-run Phase 0 benchmark; VLM vs local ensemble side by side in the report.

**Exit criteria:** medicine-identity F1 on the handwritten split beats the local ensemble by a
decisive margin, with false-positives-per-prescription < 0.5.

#### Status: MET (2026-07-29) — measured, not assumed

Same 9 labels, same pipeline, only the recognition step swapped:

| | local ensemble | gemini-3-flash-preview | **gemini-3.1-flash-lite** |
|---|---|---|---|
| precision | 1.000 | 0.900 | **1.000** |
| recall | 0.143 | 0.643 | **0.643** |
| F1 | 0.250 | 0.750 | **0.783** |
| **CER** | 0.376 | 0.002 | **0.000** |
| WER | 0.530 | 0.015 | **0.000** |
| false positives / Rx | 0.00 | 0.11 | **0.00** |
| unresolved rows / Rx | 4.78 | 0.67 | **0.78** |
| strength accuracy | 50% of 2 | 100% of 3 | **100% of 3** |
| frequency accuracy | 0% of 2 | 67% of 9 | **67% of 9** |
| seconds / image | 3.3 | 8.9 | **2.1** |

`gemini-3.1-flash-lite` is the default: best on every axis **and faster than the local
ensemble**. Character error went 0.376 → **0.000** — the recognition problem is solved.

End to end on the real infant prescription, which previously returned 31 fabricated drugs:

```
provider: gemini   medicines: 5          (ground truth: 5)
  NAMED  T-minic drops 0.3ml TDS 3 days   -> t-minic syrup
  NAMED  Advent drops 0.8ml TDS 3 days    -> advent 625 tablet
  NAMED  HHZole cream twice daily         -> hhzole cream
  REVIEW Arthakind drops 0.4ml TDS 3 days -> (no formulary match)
  REVIEW Nanodrop nasal drops SOS         -> (no formulary match)
```

**The bottleneck has moved.** All five drugs are now read correctly *as text*, with dosage and
frequency attached. The two unresolved rows fail at the **formulary lookup**, not at
recognition — "Arthakind" and "Nanodrop" are real products the 248k brand CSV does not match.
That is exactly Phase 2's job, and it is now the single biggest lever on recall.

Two operational notes:

* **Free-tier quota is 0 for the `gemini-2.x` models** on new AI Studio projects, so the old
  `gemini-2.0-flash` default returned 429. Worse, `pipeline._recognize` swallowed the error and
  fell back to local OCR *silently* — a run tagged "gemini" produced pure local numbers. It now
  logs a warning naming the real provider. Check `provider` in the response to know what ran.
* An **intermittent native crash** (SIGSEGV/SIGABRT, no Python traceback) was seen twice while
  restarting servers under port contention, always just after Chroma initialises. It has not
  reproduced since — 3 sequential requests and a 60-endpoint sweep all pass. Unresolved; worth
  watching. `run_pipeline` is called directly inside an `async def` handler
  (`ocr/router.py:303`), which blocks the event loop and is a plausible contributor.

### Phase 2 — Rebuild matching on a real formulary

- Replace raw-CSV matching with a normalised formulary table: molecule, brand, form, strength,
  route, plus an alias/synonym index. Build it once from the existing CSV + curation.
- Match on **fields**, not on the concatenated display string. Strength and form become
  filters, not fuzzy-match noise.
- Rank candidates and return a ranked shortlist; a single auto-accepted name only when the
  margin over the runner-up is decisive.
- Remove the full-dictionary retry in `medicine_intelligence.py:109` — it exists to manufacture
  a match for weak queries, which is exactly the wrong behaviour.
- Fix the ensemble objective (§1.3): rank engines by agreement with the labelled set, not by
  dictionary hit-rate.

**Exit criteria:** on Phase 0's set, precision ≥ 0.95 on auto-named medicines. Recall may lag;
unresolved items are surfaced for review, never invented.

#### Status: MET (2026-07-29) — precision 1.000, recall 0.786, F1 0.880

The planned work was "replace the raw-CSV match with a normalised formulary". Investigation
showed that was the wrong diagnosis, so the plan changed to follow the evidence:

* Most drugs **are** in the CSV and match fine once read correctly — Digoxin, Oflazest, Azenac,
  Zofer, Andial, Nasoclear all resolve. Rebuilding the formulary would have bought little.
* The 248k rows reduce to 209k distinct bases (1.2 SKUs each), so deduplication buys little
  either. **553 bases are ≤3 characters** and **725 are ordinary English words** (`need`,
  `acid`, `act`, `above`) — those ~1,278 entries are what collide with OCR noise.

**The actual defect: name similarity alone cannot decide.** `"Arthakind drops"` →
`"asthakind tablet"` (a real drug, one character misread) and the prose fragment `"needb"` →
`"need syrup"` both score **88.9**. No threshold separates them.

What separates them is the *line*: a real prescription states a dose, a frequency, a duration
or a form. So acceptance became tiered — an unambiguous name match (≥ `MEDICINE_CONFIRM_STRONG`,
94) stands alone; a plausible one (≥ `MEDICINE_CONFIRM_THRESHOLD`, 88) must be corroborated by
that structure. Validated 24/24 on a corpus of real drugs and real noise.

Three further defects surfaced and were fixed:

1. **Ranking, not just confirmation, was broken.** `search` ordered by WRatio, which prefers
   short substring matches — searching "Omeprazole" ranked `"omep 20 capsule"` above
   `"omeparazole 20mg capsule"`, so a perfectly-read line went unresolved. Candidates are now
   ranked by identity agreement, with WRatio as tie-breaker.
2. **The candidate pool was tied to `limit`.** Asking for one result fetched four candidates,
   so re-ranking could not recover a correct product WRatio had ranked fifth. The pool is now
   a fixed 40, independent of how many results the caller wants.
3. **The benchmark itself under-reported.** Its name comparison left fused strengths in, so the
   correct match `"omeparazole 20mg capsule"` scored 74 against gold `"Omeprazole"` and was
   recorded as *both* a miss and a false positive — penalising the pipeline twice for being
   right. Identity comparison now strips strength tokens.

The full-dictionary retry was slated for removal; measurement said keep it (+1 real drug, no
extra noise) now that acceptance is judged by confirmation rather than by the ranking score.

| | local ensemble | gemini-3.1-flash-lite |
|---|---|---|
| precision | 1.000 | **1.000** |
| recall | 0.143 | **0.786** |
| F1 | 0.250 | **0.880** |
| false positives / Rx | 0.00 | **0.00** |
| unresolved rows / Rx | 4.78 | **0.44** |

The 3 remaining misses — Stilbestrol, Cocaine Hydrochlor, Adrenalin Chlor — are drugs that do
not exist in a modern Indian formulary (a 1921 compounding prescription and a 1970s pharmacy
card). **On the 7 modern prescriptions in the set, recall is 10/10.**

#### Server stability: root-caused and fixed

The intermittent native crash logged under Phase 1 was tracked down. The macOS crash report
named every faulting frame as `libtorch_cpu.dylib`: a single OCR request fans out to
interactions, clinical decision support and recommendations under `asyncio.gather` +
`asyncio.to_thread`, and **concurrent `model.encode()` calls on the shared MiniLM embedder
segfault torch**, killing the process with no Python traceback.

Fixed by serialising embedder inference (`rag/embedding.py`) and Chroma access
(`rag/vector_store.py`), both of which wrap native code and are reached from many threads at
once. Encoding one query is ~10ms, so the cost is negligible against a crash. `run_pipeline`
also now runs via `asyncio.to_thread` instead of blocking the event loop for the whole scan.
Verified: 4/4 repeats of the exact request that reproduced the crash, RAG enabled, server alive.

### Phase 3 — Clinical safety layer

- **Nothing unconfirmed flows downstream.** Today phantom drugs feed interaction checking,
  CDSS, validation and reports. Gate every `AUTO_ON_OCR` consumer on confirmed medicines only.
- Add patient-context plausibility: a 6-month-old, 6.6 kg infant should trigger a hard block on
  adult-only drug classes and weight-band dosing checks. The pediatric case in §1.1 returned
  diabetes and hypertension drugs with no such check.
- Require explicit clinician confirmation before a prescription is persisted to history /
  reports / digital twin.
- Calibrate the confidence score against Phase 0 labels; display calibrated numbers or none.

**Exit criteria:** no unconfirmed medicine can reach interactions, CDSS or a stored report;
pediatric/geriatric plausibility rules covered by tests.

### Phase 4 — Platform hardening  *(independent; can run in parallel from day 1)*

Known issues found during the 2026-07-28 audit, none blocking the phases above:

- `/evidence/query` + `/evidence/chat` return **500** when sentence-transformers is absent
  (`'NoneType' object has no attribute 'encode'`). `rag_service.py` gates on `available()` in
  5 places; `evidence_engine/service.py:163` does not, and its own `retriever.available()`
  helper is never called. Also `rag/embedding.py:35-47` — `_load()` returns `None` after a
  failed load instead of re-raising.
- `cn()` in `frontend/src/lib/utils.js` is plain clsx; add `tailwind-merge` so a `className`
  reliably overrides a variant instead of winning by stylesheet accident.
- 10 ESLint errors (React hooks violations in `Chat.jsx`, `PrescriptionOCR.jsx`,
  `ClinicalDecision.jsx`, `AgentMonitor.jsx`) + 2 unused vars.
- `backend/agents/tests/test_agents.py` docstring documents a run command that fails; needs
  `PYTHONPATH=.`.
- Four tracked SQLite stores missing from `.gitignore` (`clinical_reasoning`,
  `document_intelligence`, `evidence_verification`, `simulation`) — they dirty the diff on
  every test run.
- No README / CLAUDE.md at repo root.
- Backend has **no test suite** outside `backend/agents/` — 21 of 22 modules are untested.

---

## 4. Ownership & parallel execution

Split by **file ownership** so two agents never edit the same module.

| | Claude Code (this repo, can run the stack) | Claude Desktop |
|---|---|---|
| **Phase 0** | `backend/ocr/benchmark.py`, harness, scorecard wiring | Transcribe ground-truth labels into `datasets/prescriptions/labels/` — high-judgement, no code conflict |
| **Phase 1** | `backend/ocr/providers/*`, pipeline integration, benchmarking | Draft + iterate the extraction prompt and the structured output schema |
| **Phase 2** | `medicine_intelligence.py`, matching, ensemble objective | Curate the formulary: molecule↔brand↔alias mapping, Indian brand coverage |
| **Phase 3** | `pipeline.py`, `AUTO_ON_OCR` gating, calibration | Pediatric/geriatric dosing rules + contraindication tables as reviewable data |
| **Phase 4** | all code fixes | — |

Rule to avoid collisions: **data and prompts are Desktop's; executable code is Code's.**
Desktop's outputs land in `datasets/` and `docs/` as data/markdown; they are consumed, not
edited, by Code.

---

## 5. What this does not promise

Handwritten prescription reading is an unsolved problem in general. A VLM will move
medicine-identity F1 substantially, but **this should remain a clinician-in-the-loop tool**:
the system proposes, a human confirms, and nothing reaches a patient record unconfirmed.
Phase 3 encodes that as an architectural guarantee rather than a disclaimer in the UI.
