# Platform Architecture Overhaul — Assessment & Phased Plan

Status: **draft for approval** · Written 2026-08-02 · Owner: engineering

The prescription reader was fixed feature-first (see `PRESCRIPTION_OCR_OVERHAUL.md`). The
platform around it was never restructured to match. This document measures what that cost,
defines the target architecture, and sequences the work into seven phases that each land
green.

Decisions already taken (2026-08-02): group nav **and** merge genuinely-overlapping pages;
adopt TanStack Query; scope covers frontend restructure, frontend test harness, and backend
consolidation.

---

## 1. Assessment

Everything below is counted from the tree at commit `30b8ceb`, not estimated.

### 1.1 The sidebar is a flat dump of every route

`frontend/src/layout/nav.js` lists **27 items with no hierarchy** — including five
governance sub-pages hoisted to top level (`/governance/pipeline`, `/models`, `/datasets`,
`/audit-logs`, plus the overview). The sidebar is the whole route table rendered verbatim,
so every feature ever added is permanently in the user's face at equal weight. There is no
grouping, no collapse, no search, and `Profile` sits in the same list as `Clinical Decision`.

Two consequences beyond aesthetics:

* **No information scent.** `Dataset Evaluation` (the OCR benchmark harness) and
  `Dataset Registry` (governance metadata) sit six rows apart and are unrelated.
  `Evidence Explorer`, `Evidence Verification` and `Knowledge Base` are three separate
  destinations for the same user intent: *ask a question, get a sourced answer*.
* **`Topbar` resolves its title by scanning the same flat array with `startsWith`**
  (`layout/Topbar.jsx:6-11`). It works today only because `/governance` happens to carry
  `end: true`. It is order-dependent and will silently mistitle the next nested route added.

### 1.2 Every page hand-rolls its own data layer

| measure | count |
|---|---|
| pages | 28 |
| `useState` calls across pages | **202** |
| pages repeating `setLoading` / `setError` | 26 of 28 |
| `try {` blocks in pages | 90+ |
| server-state library | **none** |

`lib/api.js` is a single **890-line** file exporting ~93 functions across 21 domains. Each
page then re-implements loading flags, error capture, toast plumbing and refetch by hand.
Polling pages (`AgentMonitor`, `DatasetEvaluation`) hand-roll their own intervals. Nothing
is cached or deduplicated: navigating away and back refetches from zero every time.

### 1.3 No resilience and no tests on the frontend

* **0** occurrences of `lazy(`, `Suspense`, or `ErrorBoundary` in `frontend/src`. All 28
  pages are eagerly imported in `App.jsx` — one bundle, and one page throwing takes down
  the entire app to a white screen.
* **0** frontend test files. `make lint` is the only automated gate.
* `ui/` mixes true primitives (`Button`, `Card`, `Badge`, `Skeleton`) with heavyweight
  domain components (`ClinicalReasoningReport` 422 LOC, `DrugInteractionReport` 256 LOC),
  so there is no primitives layer to build against.

### 1.4 The backend repeats its persistence layer sixteen times

21 routers registered across 22 module directories (~33k LOC). The module convention itself
is good — `router / service / schemas / models`, best-effort integrations — but:

* **16 files call `create_async_engine` independently**, each with its own
  `async_sessionmaker`, its own `_db_init_lock`, its own `_db_ready` flag and its own
  copy-pasted `_ensure_db()`. That is 16 SQLite files with no shared session, no
  migrations, and no way to join across modules.
* **`config.py` is 528 flat lines** for a 75-line `app.py`.
* The OCR fan-out is hand-coded: `ocr/router.py` defines six `_attach_*` functions
  (interactions, clinical, validation, recommendations, report, governance), each guarded
  by its own `*_AUTO_ON_OCR` flag and each doing a **lazy import inside the function body**
  to dodge circular imports. The "never fatal" guarantee is re-implemented per hook rather
  than enforced in one place.
* **3 of 22 modules have tests** (`ocr/`, `agents/`, `clinical_decision/`) — and the
  auto-chain above, the single highest-risk path in the product, is not among them.

### 1.5 Verdict

Nothing here is broken; that is precisely why it needs attention now. The codebase grew by
addition — every feature added a router, a page, a nav row, a database and a copy of the
same loading code. The cost is paid on every future feature, and it is compounding.

---

## 2. Target architecture

### 2.1 Information architecture: 27 → 7

```
Dashboard
Copilot            · Workspace · Chat
Intake & Records   · Prescription · Documents · History · Reports
Clinical           · Decision · Reasoning · Symptoms · Disease · Simulator
Patients           · Context · Digital Twin
Knowledge          · Medicines · Knowledge Base · Evidence
Governance         · Overview · Pipeline · Models · Datasets · Audit · Agents · Benchmarks

Profile → topbar avatar menu (off the sidebar entirely)
```

Groups collapse; the active group auto-expands; collapse state persists. A **⌘K command
palette over the same route table** is what makes a compact sidebar safe — every one of the
28 destinations stays one keystroke away, which is why depth is acceptable here and is not
today.

Full mapping — no destination is dropped:

| today (27) | destination |
|---|---|
| Dashboard | Dashboard |
| Copilot Workspace | Copilot › Workspace |
| AI Assistant (Chat) | Copilot › Chat *(merge candidate, §2.2)* |
| Prescription OCR | Intake › Prescription |
| Document Intelligence | Intake › Documents |
| Prescription History | Intake › History |
| Medical Reports | Intake › Reports |
| Clinical Decision | Clinical › Decision |
| Clinical Reasoning | Clinical › Reasoning |
| Symptom Checker | Clinical › Symptoms |
| Disease Prediction | Clinical › Disease |
| Treatment Simulator | Clinical › Simulator |
| Patient Context | Patients › Context |
| Digital Twin | Patients › Digital Twin |
| Medicine Search | Knowledge › Medicines *(merged)* |
| Medicine Recommendations | Knowledge › Medicines *(merged)* |
| Knowledge Base | Knowledge › Knowledge Base |
| Evidence Explorer | Knowledge › Evidence *(merged)* |
| Evidence Verification | Knowledge › Evidence *(merged)* |
| AI Governance | Governance › Overview |
| Pipeline Viewer | Governance › Pipeline |
| Model Registry | Governance › Models |
| Dataset Registry | Governance › Datasets |
| Audit Logs | Governance › Audit |
| AI Agent Monitor | Governance › Agents |
| Dataset Evaluation | Governance › **Benchmarks** *(renamed — it is the OCR benchmark)* |
| Profile | topbar avatar menu |

### 2.2 Page merges: 28 → 21

| merge | into | why |
|---|---|---|
| Evidence Explorer + Evidence Verification | `/knowledge/evidence`, tabs *Ask* / *Verify* | same intent, same mental model, adjacent backends |
| Medicine Search + Medicine Recommendations | `/knowledge/medicines`, tabs *Look up* / *Alternatives* | you always want both for one drug |
| 5 governance pages | `/governance` shell + tab panels | sub-routes preserved; 5 nav rows → 1 |
| Chat | Copilot Workspace, as a *Quick ask* mode | Chat is `predict + RAG`; Copilot is the session-based superset |

**Explicitly not merged:** Prescription OCR and Document Intelligence. They look similar
(both upload→extract) but OCR carries the entire clinical auto-pipeline UI (20 `useState`)
and Documents carries type classification. They share an extracted `<FileIntake>` component
instead — upload, preview, quality gate, progress.

### 2.3 Frontend layout

```
frontend/src/
  app/
    App.jsx           lazy route tree
    routes.js         ← single source of truth: path, label, icon, group, element
    providers.jsx     QueryClient · Theme · Toaster · ErrorBoundary
  shared/
    api/              client.js + one module per domain (replaces the 890-line api.js)
    hooks/            useX query hooks, one per domain
    ui/               primitives ONLY
    lib/              utils · pdf · storage · triage · followups
  features/
    dashboard/ copilot/ intake/ clinical/ patients/ knowledge/ governance/
      └ each: pages, components, and its own domain report components
```

`routes.js` drives the sidebar, the topbar title, breadcrumbs and the command palette from
one array — the drift in §1.1 becomes structurally impossible.

### 2.4 Backend

* **`backend/core/db.py`** — one `create_store(name, Base, url)` factory returning
  `(session_factory, ensure_db)`. Replaces 16 copies of the engine/lock/flag block. Each
  module keeps its own SQLite file for now; one implementation, sixteen call sites.
* **`backend/core/pipeline.py`** — a post-extraction hook registry. Modules register
  `(name, order, timeout, flag)`; the OCR router iterates. Replaces six `_attach_*`
  functions and their lazy imports, makes ordering explicit, and enforces "never fatal"
  in exactly one place — which is also the first thing that becomes testable.
* **`config.py`** → grouped nested settings, `settings.X` aliases retained for compatibility.
* **`app.py`** → router registry with tags matching the frontend groups, so `/docs` mirrors
  the product IA.

---

## 3. Phases

Each phase ends green: `make lint`, `make test`, and (from Phase 0) `make test-ui`.

### Phase 0 — Baselines and the safety net
*Nothing else starts until this is green.*

* Record baselines: bundle size, route inventory, `make test` (66 backend tests),
  OpenAPI path count (104 paths / 121 operations).
* Add **Vitest + React Testing Library**, `make test-ui`.
* Write the **route-inventory test**: every entry in the route table mounts, every nav
  target resolves, no orphan routes. This is the test that makes Phases 2–3 safe.

**Exit:** `make test-ui` green; baselines committed to `docs/benchmarks/`.

### Phase 1 — Frontend foundation *(zero visible change)*

* `app/providers.jsx` — QueryClientProvider, Theme, Toaster, app-level **and** per-route
  ErrorBoundary.
* Split `lib/api.js` into `shared/api/<domain>.js` behind a barrel re-export, so no page
  changes in this phase.
* Lazy-load all routes with a Suspense skeleton.

**Exit:** lint + both test suites green; per-route chunks in the build; UI byte-identical.

> **Sequencing change, 2026-08-02.** Moving the domain report components out of `ui/` was
> listed here; it moved to Phase 3. Their destination is the `features/` tree, which Phase 3
> creates when the pages themselves move — doing it in Phase 1 would move the same files
> twice. `ui/` therefore still mixes primitives and domain components until Phase 3.

### Phase 2 — Route table and sidebar *(the compaction)*

* `app/routes.js` as the single source; sidebar renders collapsible groups with persisted
  state; topbar title and breadcrumbs derived from it (deletes the `startsWith` scan).
* **⌘K command palette** over the route table.
* `<Navigate replace>` for all 27 legacy paths.
* Profile moves to a topbar avatar menu.

**Exit:** 7 sidebar entries; all 27 old URLs still resolve; route-inventory test green.

### Phase 3 — Page merges

* Governance shell + 5 tab panels; Knowledge Medicines; Knowledge Evidence; Chat folded
  into Copilot; `<FileIntake>` extracted from OCR + Documents.

**Exit:** 28 pages → 21 with no capability lost; redirects hold; tests green.

### Phase 4 — Clinical correctness & honesty

Added 2026-08-02 after an audit of the running system, and placed **ahead of the remaining
refactoring**: everything below can mislead a user about their health, which outranks code
structure. The later phases shift down by one (TanStack becomes 5, backend 6, hardening 7).

**4.1 — Symptom resolution stops guessing.** Typing `hiv` currently resolves to the symptom
**`shivering`** (score 90, cutoff 82) and is fed to the model as if the user had typed it;
`AIDS` then appears in the results. The cause is `fuzz.WRatio`, whose partial-match path
returns 90 for any substring — and "hiv" is a substring of s-**hiv**-ering.

Measured across 9 legitimate typos and 9 disease-names/gibberish:

| scorer | worst legitimate typo | best junk match | separable? |
|---|---|---|---|
| `WRatio` (current) | 78.8 | **90.0** (`hiv`→shivering, `flu`→fluid overload) | **no** |
| `ratio` | 94.1 | 54.5 (`aids`→acidity) | **yes, by ~40 points** |

So: `match_one` switches to `fuzz.ratio`, keeping the 82 cutoff. No threshold on `WRatio`
can work — every real prefix also scores exactly 90.

**4.2 — Autocomplete stops inventing symptoms.** `symptoms.suggest()` calls
`process.extract` with **no `score_cutoff` at all**, so it always returns 8 results however
bad: `xyzzy` → *dizziness*, `asdfgh` → *skin rash*, `aids` → *blackheads*. It offers terms
its own matcher would reject. Replaced with word-boundary prefix matching plus
typo-tolerant `ratio` matching, so a query that matches nothing returns nothing.

**4.3 — The user is told when their input was changed.** A fuzzy match is a guess and must
read as one. The API already returns `resolved_symptoms` with `method` and `score`; the UI
must surface "we read *hiv* as *shivering*" and let it be dismissed, and must show
unmatched inputs rather than dropping them silently.

**4.4 — The model declines to rank when there is no signal.** `headache` alone currently
returns *"Paralysis (brain hemorrhage)"* at 22.85%. Below a floor, return no ranked list at
all. The explanation template also asserts a relationship the model never established
("Your reported high fever is commonly seen in AIDS") and must be reworded as association,
not inference.

**4.5 — Model integrity.** The classifier is unpickled by a different scikit-learn than
trained it (1.7.2 vs 1.9.0); sklearn warns this "might lead to breaking code or invalid
results". Pin or re-fit. Also fix the user-visible label typo
`(vertigo) Paroymsal  Positional Vertigo`.

**4.6 — Delete fabricated UI data.** `Dashboard.jsx` renders a hardcoded 7-point array as
an activity chart beside a hardcoded `+18%` trend badge. Invented numbers next to real ones
discredit both.

**Exit:** typing a disease name or gibberish yields no symptom and says so; a single vague
symptom produces no ranked diagnosis; no fabricated values anywhere in the UI; backend tests
covering the reject-list above (making `disease/` the fourth tested module).

### Phase 5 — TanStack Query migration

Migrate in ascending risk order:
1. read-only (`AuditLogs`, `ModelRegistry`, `DatasetRegistry`, `PipelineViewer`, `Dashboard`)
2. polling (`AgentMonitor`, `DatasetEvaluation`) → `refetchInterval`
3. form + mutation pages
4. the two heavy ones last: `CopilotWorkspace` (14 `useState`), `PrescriptionOCR` (20)

`PrescriptionOCR` is the one place needing care: it must keep the 5-minute `OCR_TIMEOUT`,
upload progress, and `AbortSignal` cancellation intact.

**Exit:** `setLoading`/`setError` in pages → ~0; documented `useState` reduction from 202;
navigation between pages serves from cache.

### Phase 5 — Backend consolidation

* `core/db.py` store factory replacing all 16 duplicated engine blocks.
* `core/pipeline.py` hook registry replacing the six `_attach_*` functions.
* Grouped `config.py`; router registry in `app.py` with IA-aligned tags.

**Exit:** `make test` green; OpenAPI still 104 paths / 121 operations; a live
`POST /ocr/extract-prescription` produces auto-chain output **identical** to the current
pediatric baseline (risk `moderate` / 51.0, infant red flag).

### Phase 6 — Coverage and hardening

* Backend: shared `conftest`; cover the store factory and the auto-chain first; target
  8 of 22 modules.
* Frontend: shared api client, query hooks, nav resolution, merged pages.
* *Optional, deferred:* single `medisense.db` + Alembic migrations. Held back deliberately —
  it is the only step in this plan that touches existing data.

**Exit:** coverage numbers recorded in this document.

---

## 3a. Progress

| phase | state | commit | evidence |
|---|---|---|---|
| 0 — baselines & safety net | **done** | `9fafb9c` | 62 tests; 5/5 mutations caught |
| 1 — frontend foundation | **done** | `36ca73a` | 88 tests; 11/11 caught; app chunk 1,070 → 326 kB |
| 2 — route table & sidebar | **done** | `c962196` | 150 tests; 8/8 caught; 27 → 7 sidebar rows |
| 3a — features tree | **done** | `4b5a026` | 161 tests; 4/4 caught; 0 cross-feature imports |
| 3b — tabbed merges | **done** | `868e0a3` | 166 tests; 6/6 caught; Knowledge 5 → 3 rows |
| 4 — clinical correctness | **done** | | 20 backend + 1 frontend test; 11/11 mutations caught; both matchers |
| 7a — dependency vulns | **done** | | npm audit 9 -> 2; the 2 assessed as unreachable |
| 3c — governance shell | **not started** | | see note below |
| 3d — Chat into Copilot, shared FileIntake | **not started** | | |
| 5 — TanStack Query migration | **done — 27 of 27** | `0d31210`…`72e740b` | 259 tests; 83/87 caught; `useState` 202 → 113; 0 `setLoading`/`setError` left |
| 6 — backend consolidation | **not started** | | 16 duplicated engine blocks untouched |
| 7 — coverage & hardening | **not started** | | incl. the parked npm audit bumps |

Phases 1–5 were merged to `main` on 2026-08-08 via PR #1 (`caf9c3d`); `72e740b`
(`DiseasePrediction`) sits on `main` after it. Later work continues on `main`.

**Note on 5.** Migrated so far: `AuditLogs`, `ModelRegistry`, `DatasetRegistry`,
`PatientContext`, `DigitalTwin`, `PipelineViewer`, `AgentMonitor`, `DatasetEvaluation`,
`MedicineSearch`, `MedicineRecommendations`, `KnowledgeBase`, `EvidenceVerification`,
`EvidenceExplorer`, `MedicalReports`, `PrescriptionHistory`, `ClinicalDecision`,
`ClinicalReasoning` — tranches 1 and 2 (read-only, then polling) complete, the whole
Knowledge group migrated, both intake list pages, and two of the five clinical pages.
`SymptomChecker` and `TreatmentSimulator` complete the clinical group.

**`DiseasePrediction` closed the phase (2026-08-08, `72e740b`).** The product decision it
was held for was resolved as *label the numbers and migrate in one pass*: the model scores
top-1 = 1.000 only because its 304 unique rows are duplicated 16×, so the results panel now
carries a "Demo dataset — not calibrated probabilities" note beside the ranked list, and
"Ranked by probability" became "Ranked by match strength". The page-top "small dataset"
banner already existed and was not sufficient — it sits three cards from the numbers and
says nothing about what is wrong with them. Real clinical data and confidence calibration
remain open; this labels the gap rather than closing it. Two behaviours are pinned by test
because neither is visible when broken: the follow-up buttons pass symptoms as the
mutation's *variables* (reading `selected` submits the previous render's value), and the
symptom vocabulary's shared cache key is enforced structurally across all five call sites in
`architecture.test.js`. `PrescriptionOCR` is done, migrated last
as planned: the 5-minute timeout, upload progress, `AbortSignal` cancellation, the quality
gate and the inline auto-chain all survive, each with a test. `CopilotWorkspace` is done — its transcript now lives in the query cache
rather than in a second copy of the messages, so a chat turn and the session's own history
have one home. `DocumentIntelligence` was the rehearsal for the second: upload progress and
`AbortSignal` both survive a mutation unchanged, and a cancelled upload stays a
cancellation rather than becoming an error. `useApiQuery`/`useApiMutation` grew one
option in the process: `toastErrors: false`, for pages that render the failure inline. It is
opt-out, so the default stays "the toast cannot be forgotten". **No server polling is hand-rolled any
more**: the four remaining `setInterval` calls in `features/` are UI animation timers (step
cycling, a typewriter, an elapsed clock), which are not server state and stay as they are. Two behaviours the migration introduced were carried for
several commits with no working test — mutation invalidation and dependent queries — because
of a defect in the test harness rather than in the pages. Both are now covered
(`queryInvalidation.test.jsx`, `dependentQueries.test.jsx`) and 10 mutations across the two
pages and the shared hook are caught. See the harness note below before writing more.

**Note on 3c.** Phase 2 already collapsed the five governance pages into one collapsible
sidebar group, which is most of what the tabbed shell was for. What remains is shared chrome
(one header, one data fetch) across the seven governance routes — worth doing, but no longer
urgent, and it should use the same `tabGroup` mechanism 3b introduced rather than a bespoke
shell.

Each phase is mutation-tested, not just run: the suite is re-verified by deliberately
breaking things and confirming it fails. **117 mutations introduced across six phases, 113
caught, one a proven no-op and three redundant code** — fourteen of them only after a gap in the tests was found and closed. Every gap below
was found by breaking code, none by reading it.

* **Phase 1 hid page crashes.** The new per-route error boundary swallowed a throwing page,
  so the route tests went green on a broken app. Fixed by asserting no boundary is showing
  (`queryByRole('alert')`) and by waiting for the lazy chunk before asserting anything —
  without the wait, every assertion ran against the Suspense fallback.
* **The barrel could silently lose a whole domain.** Deleting one
  `export * from '@/shared/api/<domain>'` line passed all 62 tests: most pages catch their
  own fetch errors into a toast, so an endpoint that became `undefined` never reached a
  boundary. Closed by `apiSurface.test.js`, which discovers the domain modules with
  `import.meta.glob` and asserts the barrel re-exports all of them.

Also fixed while verifying: the API mock originally faked `@/lib/api`, which any page could
have escaped by importing a domain module directly. It now fakes the shared axios instance
instead, so all 23 domain modules run their real code and no import path can bypass it.

* **Phase 2's sidebar defaulted to open.** Every group started expanded, so all 26
  destinations were still on screen — the compaction was cosmetic. Groups now start closed
  with the active one deriving itself open, and a test pins the resting state at seven rows.
* **Escape only closed the palette while its input had focus.** The listener moved to the
  document, since the dialog is modal.

Reverting the `findRoute` specificity fix breaks 60 of the 150 tests, which is the intended
level of coverage for the piece of behaviour that was previously order-dependent.

* **The client mock was one mock wearing five hats.** `buildClientMock` built every verb as
  `vi.fn(respond)` from a single shared `respond`, and `vi.fn` hands back a function that is
  already a mock rather than wrapping it — so `API`, `API.get`, `API.post`, `API.put`,
  `API.patch` and `API.delete` were the *same object*, with one implementation and one call
  log. Installing a POST behaviour rewrote what GET returned, and
  `expect(API.post).toHaveBeenCalledWith(...)` was satisfied by any GET. This, not
  `restoreMocks`, is why the first mutation-invalidation test passed with invalidation
  deleted from both the hook and the page. Each verb now gets its own mock, and
  `apiMockContract.test.js` tests the harness itself.
* **The recorded cause of that failure was wrong for four commits.** `restoreMocks: true`
  was blamed for discarding mock implementations between tests. Measured on Vitest 4.1.10 it
  does the opposite: `vi.spyOn` spies are restored, `vi.fn` implementations are **kept**, and
  only call history is cleared. The practical rule is unchanged — install behaviour in
  `beforeEach` — but for the opposite reason: an implementation one test installs leaks into
  every later test in the file. Both facts are now asserted, not narrated.
* **A polling page that never stops polling looks fine.** The migration's stop condition is
  a `refetchInterval` returning `false` on a terminal status; get it wrong and the page
  requests every 1.2s forever while the run card sits there saying "Completed". The tests
  therefore assert the *stop*: after a terminal status the request count must not move
  again. They run on real timers and take a few seconds, because fake timers stall RTL's
  `waitFor` — it detects them through a `jest` global this project does not have.
* **A search box is where this migration can quietly get much worse.** Key the query on the
  input rather than on an applied term and every keystroke becomes a request — "Augmentin"
  is nine lookups and the page looks entirely normal. `MedicineSearch` keeps `query` (the
  box) separate from `term` (what was searched), and the test types eight characters and
  asserts zero requests.
* **An assertion can watch the wrong element and never say so.** The first Evidence tests
  asserted the verification response text appeared after a verify — and it did, in the
  *form textarea*, which the page fills from the response. The result panel renders
  `verdict` and `metrics`, so the panel could have rendered nothing at all and the test
  would still have passed. Found by mutation: flipping the result precedence changed
  nothing. The fixtures now carry a distinct `verdict` per source, so each assertion names
  which result is on screen.
* **Not every surviving mutation is a test gap.** Three survived here; one was a genuine
  gap, one a no-op, and two were redundant code — a reset the precedence rule already
  decided, and a `setTurns([])` that `setMode('query')` already covered. Both were deleted
  rather than pinned with a test that would have been asserting nothing.
* **An incomplete fixture crashes the page instead of failing the assertion.** Three
  fields the Treatment Simulator dereferences without a guard — `result.side_effects.length`,
  `result.confidence.overall` — took the page to its error boundary, and the test reported
  only "unable to find text". Worth knowing in both directions: it is how a fixture gets
  corrected quickly, and it is a real robustness gap if the backend ever omits a field.
* **Phase 5's two behaviours had no working test.** With the harness fixed, mutation
  invalidation and dependent queries were covered properly: 10 mutations across
  `useApiMutation`, `PatientContext`, `DigitalTwin`, `ModelRegistry` and `DatasetRegistry`,
  all caught. One survived the first pass — deleting `setSelectedId('')` after a delete —
  because no test had ever *explicitly chosen* the patient it then deleted; a seventh test
  now covers that, and it fails without the reset.

## 4. Risks

| risk | mitigation |
|---|---|
| **Two-agent ownership collision** — the Desktop extension edits these same files mid-session | re-read files immediately before editing; one phase in flight at a time |
| `PrescriptionOCR` migration (20 `useState`, 5-min timeout, abort, progress) | last in Phase 4, on its own, with the OCR smoke test as gate |
| Backend DB refactor touches 16 files | factory + tests land first; call sites convert one at a time |
| Merged pages silently lose a capability | route-inventory test from Phase 0 + explicit per-merge checklist |
| Public repo | `backend/.env` stays untracked — see the env-handling note before any config commit |

## 5. Non-goals

No auth or multi-tenancy. No visual redesign — Tailwind tokens and dark mode stay as they
are. No backend framework change. No data migration before Phase 6. The prescription
overhaul's open items (labels ≥100, clinician confirmation, calibration) are tracked
separately in `PRESCRIPTION_OCR_OVERHAUL.md` and are not touched here.
