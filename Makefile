# Medical AI Copilot — developer entrypoints.
#
# The venv must be Python 3.12: the ML stack (torch / easyocr / chromadb) has no
# wheels for the system 3.14.

PY := ./venv/bin/python
NPM := npm --prefix frontend

.DEFAULT_GOAL := help
.PHONY: help bench bench-handwritten bench-printed test test-ocr test-agents test-clinical test-ui serve lint verify

help:  ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

# --- Benchmark (overhaul plan, Phase 0) ------------------------------------
# Scores the live pipeline against the hand-labelled set in
# datasets/prescriptions/labels/ and writes a markdown + JSON scorecard to
# docs/benchmarks/. This is the baseline every later phase is judged against;
# commit the report it produces. Runs serially — one image is ~26s and each
# spawns the multi-engine torch ensemble.
bench:  ## Score the pipeline against ground truth -> docs/benchmarks/
	$(PY) -m backend.ocr.benchmark $(ARGS)

bench-handwritten:  ## Benchmark the handwritten split only
	$(PY) -m backend.ocr.benchmark --split handwritten --tag handwritten $(ARGS)

bench-printed:  ## Benchmark the printed split only
	$(PY) -m backend.ocr.benchmark --split printed --tag printed $(ARGS)

# --- Tests ------------------------------------------------------------------
test: test-ocr test-filter test-match test-vision test-clinical test-agents  ## Run all backend tests

test-ocr:  ## Benchmark scoring tests (no OCR, fast)
	PYTHONPATH=. $(PY) backend/ocr/tests/test_benchmark.py

test-filter:  ## Medicine-line gate rules (no OCR, fast)
	PYTHONPATH=. $(PY) backend/ocr/tests/test_line_filter.py

test-vision:  ## Vision-LLM extraction path, no API key needed
	PYTHONPATH=. $(PY) backend/ocr/tests/test_vision_provider.py

test-clinical:  ## Pediatric safety chain (rules engine + risk grade, fast)
	PYTHONPATH=. $(PY) backend/clinical_decision/tests/test_pediatric_rules.py

test-agents:  ## Multi-agent layer tests
	PYTHONPATH=. $(PY) backend/agents/tests/test_agents.py

test-ui:  ## Frontend tests (Vitest + RTL) — route inventory & nav contract
	$(NPM) run test

# --- Gate --------------------------------------------------------------------
# The single command every phase of the architecture overhaul must leave green.
verify: lint test-ui test  ## Run every gate: frontend lint + frontend tests + backend tests

# --- Running ----------------------------------------------------------------
serve:  ## Start the backend on 127.0.0.1:8000
	$(PY) -m uvicorn backend.app:app --host 127.0.0.1 --port 8000 --reload

lint:  ## Lint the frontend (baseline: clean — 0 errors, 0 warnings)
	$(NPM) run lint

test-match:  ## Medicine matching + acceptance tiers (no OCR, fast)
	PYTHONPATH=. $(PY) backend/ocr/tests/test_matching.py
