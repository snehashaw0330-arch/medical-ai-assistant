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
  },
  clinical: {
    all: ['clinical'],
    stats: () => ['clinical', 'stats'],
  },
  reports: {
    all: ['reports'],
    stats: () => ['reports', 'stats'],
  },
  agents: {
    all: ['agents'],
    registry: () => ['agents', 'registry'],
    runs: (limit) => ['agents', 'runs', limit],
  },
}
