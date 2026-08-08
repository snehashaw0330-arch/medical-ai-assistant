# Architecture Overhaul — Baseline

Measured 2026-08-02 at commit `30b8ceb`, before any phase of
`PLATFORM_ARCHITECTURE_OVERHAUL.md` landed. Every later phase is judged against these
numbers; re-measure with `make verify` plus `npm --prefix frontend run build`.

## Gates

| gate | command | baseline |
|---|---|---|
| frontend lint | `make lint` | clean — 0 errors, 0 warnings |
| frontend tests | `make test-ui` | **62 passed** (new in Phase 0) |
| backend tests | `make test` | **75 passed** across 6 suites |
| all three | `make verify` | green |

Backend suites: ocr/benchmark 21 · line-filter 7 · matching 9 · vision 22 ·
pediatric-rules 5 · agents 11.

## API surface

| measure | baseline |
|---|---|
| OpenAPI paths | **104** |
| OpenAPI operations | **121** |
| router prefixes | **22** |

Re-check with:

```sh
PYTHONPATH=. ./venv/bin/python -c "
from backend.app import app; s = app.openapi(); p = s['paths']
print(len(p), sum(len([m for m in v if m in ('get','post','put','patch','delete')]) for v in p.values()))"
```

## Frontend structure

| measure | baseline | target phase |
|---|---|---|
| sidebar entries | **27** | 7 — Phase 2 |
| routes (excl. catch-all) | **27** | Phase 2/3 |
| page components | **28** | 21 — Phase 3 |
| `useState` calls in pages | **202** | Phase 4 |
| pages using `setLoading`/`setError` | **26 of 28** | ~0 — Phase 4 |
| `lib/api.js` | **890 lines, one file** | per-domain — Phase 1 |
| `lazy(` / `Suspense` / `ErrorBoundary` | **0** | Phase 1 |
| frontend test files | **0** → 2 (Phase 0) | grows each phase |

## Bundle

Single eager app chunk — Vite emits a >500 kB warning. jspdf/html2canvas already split
because they are dynamically imported.

| chunk | raw | gzip |
|---|---|---|
| `index.js` (all 28 pages) | **1,069.82 kB** | **292.52 kB** |
| `jspdf.es.min.js` | 399.18 kB | 129.50 kB |
| `html2canvas.js` | 199.56 kB | 46.78 kB |
| `index.es.js` | 151.41 kB | 48.89 kB |
| `purify.es.js` | 24.49 kB | 9.56 kB |
| `index.css` | 56.66 kB | 9.39 kB |

Phase 1 target: `index.js` drops sharply and each route becomes its own chunk.

## Backend structure

| measure | baseline | target phase |
|---|---|---|
| files calling `create_async_engine` | **16** | 1 factory — Phase 5 |
| `config.py` | **528 lines** | grouped — Phase 5 |
| OCR `_attach_*` fan-out functions | **6**, each with a lazy import | registry — Phase 5 |
| modules with tests | **3 of 22** | 8 — Phase 6 |

## Dependency vulnerabilities

Resolved 2026-08-02: **9 -> 2** via non-breaking `npm audit fix` (axios, vite, postcss,
form-data, brace-expansion, dompurify, @babel/core). Gates green afterwards.

The remaining 2 are one advisory — *React Router: open redirect via backslash in `<Link>`
and `useHref`*, affecting 7.12.0–8.2.0. **Deliberately not "fixed", because the only offered
remedy is a downgrade** from 7.18.2 to 7.11.0, which would regress the router underneath the
Phase 2 navigation system.

Assessed as unreachable here rather than assumed: the advisory needs a user-controlled URL
to reach `<Link to>` or `useHref`. Every link target in the app is a literal or comes from
the static route table (`ROUTE_TREE`, `LEGACY_REDIRECTS`, `ROUTES`), the single `navigate()`
call is `navigate(route.to)`, and `useHref` is not used at all. Re-check this if any page
ever renders a link from user input or an API response — then take the upgrade the moment a
patched 7.x ships.

## Fixed during Phase 0

* `CopilotWorkspace` rendered a second `<main>` inside the layout's `<main>` — two main
  landmarks on one page. Caught by the new route test on its first run; the centre column
  is now a `<section>`. The test asserts exactly one main landmark per route, so it cannot
  regress.
