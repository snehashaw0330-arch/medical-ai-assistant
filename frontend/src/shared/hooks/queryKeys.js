/**
 * Every query key in one place.
 *
 * Keys are what let a mutation invalidate exactly the right cache entries, so
 * they have to be predictable. Free-form arrays scattered across 27 pages are
 * how you end up with `['auditLogs']` in one file and `['audit-logs']` in
 * another, silently caching the same data twice.
 *
 * Convention: `[domain, resource, params?]` — broadest first, so
 * `invalidateQueries({ queryKey: qk.governance.all })` catches everything
 * beneath it.
 */
export const qk = {
  governance: {
    all: ['governance'],
    auditLogs: (filters) => ['governance', 'audit-logs', filters],
    models: () => ['governance', 'models'],
    datasets: () => ['governance', 'datasets'],
    dashboard: () => ['governance', 'dashboard'],
    decisions: (params) => ['governance', 'decisions', params],
    pipeline: (traceId) => ['governance', 'pipeline', traceId],
  },
  history: {
    all: ['history'],
    list: (params) => ['history', 'list', params],
    stats: () => ['history', 'stats'],
    medicines: () => ['history', 'medicines'],
    item: (id) => ['history', 'item', id],
  },
  clinical: {
    all: ['clinical'],
    stats: () => ['clinical', 'stats'],
    history: () => ['clinical', 'history'],
    // The symptom vocabulary behind the autocomplete on three pages. One key,
    // so the second and third page to mount serve it from cache.
    symptomOptions: () => ['clinical', 'symptom-options'],
  },
  reasoning: {
    all: ['reasoning'],
    history: () => ['reasoning', 'history'],
    pipeline: () => ['reasoning', 'pipeline'],
  },
  reports: {
    all: ['reports'],
    stats: () => ['reports', 'stats'],
    list: (filters) => ['reports', 'list', filters],
    detail: (id) => ['reports', 'detail', id],
  },
  patients: {
    all: ['patients'],
    contexts: () => ['patients', 'contexts'],
    context: (patientId) => ['patients', 'context', patientId],
    twinList: () => ['patients', 'twins'],
    twin: (patientId) => ['patients', 'twin', patientId],
  },
  knowledge: {
    all: ['knowledge'],
    medicine: (name) => ['knowledge', 'medicine', name],
    // Only the list moves when a report is generated; a stored report never
    // changes, so these two are deliberately separate keys rather than one
    // prefix that would re-fetch every report ever opened.
    recommendations: () => ['knowledge', 'recommendations'],
    recommendation: (id) => ['knowledge', 'recommendation', id],
    ragStatus: () => ['knowledge', 'rag-status'],
    answer: (question) => ['knowledge', 'answer', question],
  },
  evidence: {
    all: ['evidence'],
    verifications: () => ['evidence', 'verifications'],
    records: () => ['evidence', 'records'],
  },
  benchmarks: {
    all: ['benchmarks'],
    datasetInfo: () => ['benchmarks', 'dataset-info'],
    job: (jobId) => ['benchmarks', 'job', jobId],
  },
  agents: {
    all: ['agents'],
    registry: () => ['agents', 'registry'],
    health: () => ['agents', 'health'],
    runs: (limit) => ['agents', 'runs', limit],
    run: (runId) => ['agents', 'run', runId],
  },
}
