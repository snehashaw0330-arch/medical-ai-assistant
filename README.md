# MediSense — Medical AI Copilot

A clinician-in-the-loop assistant: read a prescription, predict conditions from symptoms,
check drug interactions, and produce an auditable clinical report. FastAPI backend
(22 feature modules, 104 API paths) + React 19 frontend (27 pages).

> **Status: development, not clinical deployment.** Prescription reading on handwriting is
> the known weak point — see [Accuracy, honestly](#accuracy-honestly) before trusting any
> output. Nothing here is a medical device.

---

## Setup

**Python 3.12 is required.** The ML stack (torch, easyocr, chromadb, sentence-transformers)
has no wheels for 3.14, which is the default `python3` on many machines.

```bash
python3.12 -m venv venv
./venv/bin/pip install -r backend/requirements.txt
# The RAG + local-OCR extras are commented out in requirements.txt; install them for
# the Knowledge Base, Evidence Engine and offline prescription OCR:
./venv/bin/pip install sentence-transformers chromadb easyocr pytesseract

npm --prefix frontend install
```

No API key is needed to boot: with `OCR_PROVIDER=auto` and no key set, OCR falls back to the
local EasyOCR/Tesseract ensemble and the LLM layer to a deterministic offline writer.
Copy `backend/.env.example` → `backend/.env` to configure providers.

## Run

```bash
make serve                      # backend  -> http://127.0.0.1:8000  (docs at /docs)
npm --prefix frontend run dev   # frontend -> http://127.0.0.1:5173  (proxies /api)
```

`make help` lists every target.

## Verify

```bash
make test    # 21 benchmark-scoring tests + 11 multi-agent tests
make lint    # frontend — baseline is clean (0 errors, 0 warnings)
make bench   # score prescription OCR against ground truth -> docs/benchmarks/
```

**One OCR request takes ~26s and saturates the CPU. Never run them concurrently** — parallel
requests each spawn the multi-engine torch ensemble and the whole run appears to hang.

---

## Architecture

`backend/app.py` only wires routers. Every feature module is self-contained and follows the
same shape — `router.py` / `service.py` / `schemas.py` / `models.py`, its own SQLite store via
async SQLAlchemy, and a config block in `backend/config.py`.

| area | modules |
|---|---|
| Intake | `ocr`, `document_intelligence`, `history` |
| Reasoning | `disease`, `symptom_checker`, `clinical_decision`, `clinical_reasoning`, `simulation` |
| Knowledge | `rag`, `evidence_engine`, `evidence_verification` |
| Medicines | `medicine_api`, `medicine_recommendation`, `drug_interactions`, `prescription_validation` |
| Orchestration | `agents` (10 collaborating agents), `copilot`, `patient_context`, `digital_twin` |
| Output | `report_generator` (JSON/HTML/PDF), `ai_governance` (audit + explainability) |

Two conventions worth knowing before changing anything:

* **Every integration is best-effort and non-fatal.** A RAG, CDSS or report failure degrades
  that stage only — it never aborts the caller. Preserve this when adding integrations.
* **`AUTO_ON_OCR` flags chain the pipeline.** A successful OCR automatically triggers
  interaction analysis, clinical decision support, validation, recommendation, report
  generation and a governance trace. Each is individually toggleable in `backend/config.py`.

The frontend talks to the backend through a single axios layer (`frontend/src/lib/api.js`);
components never call axios directly.

---

## Accuracy, honestly

Prescription OCR quality is **measured, not asserted** — run `make bench`. Current state on
the labelled set:

* **Named-medicine precision is high; recall is low.** The pipeline will not name a drug it
  cannot confirm. Unconfirmed rows are surfaced for manual review rather than guessed.
* **The local engines cannot read cursive handwriting.** EasyOCR/Tesseract are printed-text
  engines; measured CER is poor even on clean printed images. Setting `GEMINI_API_KEY` or
  `OPENAI_API_KEY` switches recognition to a vision model and is strongly recommended.
* Two safety gates sit between OCR and any drug identity — a line filter
  (`backend/ocr/line_filter.py`) and a whole-word match confirmation. Both are env-tunable;
  loosening them re-introduces fabricated medicines, so re-run `make bench` if you touch them.

The Dataset Evaluation page reports `medicine_detection_rate` — **coverage, not accuracy**.
It rises when the pipeline guesses more. Only `make bench` measures correctness.

Full assessment and the phased plan: **[docs/PRESCRIPTION_OCR_OVERHAUL.md](docs/PRESCRIPTION_OCR_OVERHAUL.md)**.
Ground-truth labelling rules: **[datasets/prescriptions/labels/README.md](datasets/prescriptions/labels/README.md)**.

---

## Repo layout

```
backend/          FastAPI app — one directory per feature module
frontend/         React 19 + Vite 8 + Tailwind 4
datasets/         medicines CSV, drug interactions, prescriptions + ground-truth labels
disease-prediction/  training script + trained sklearn model bundle
prescription-ocr/    OCR experiments, synthetic data, raw images
docs/             assessment, plans, benchmark scorecards
```

Local SQLite stores and generated artefacts (vector index, OCR results, retained images) are
gitignored — they regenerate on first run.
