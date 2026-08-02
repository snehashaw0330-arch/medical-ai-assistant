import { API } from './client'

// ---------------- AI Governance, Audit & Explainability ----------------
// Enterprise governance layer: every AI decision is traced, explained, audited,
// versioned and exportable. Traces are derived from the report store (read-only)
// and captured live after OCR. Sync/backfill + aggregation can be slow, so use a
// longer timeout than the fast defaults.
const GOVERNANCE_TIMEOUT = 120_000 // 2 min (sync + aggregation can be slow)

function _clean(params = {}) {
  return Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  )
}

export async function getGovernanceDashboard() {
  const { data } = await API.get('/governance/dashboard', { timeout: GOVERNANCE_TIMEOUT })
  return data
}

export async function getGovernanceVersions() {
  const { data } = await API.get('/governance/versions')
  return data
}

export async function syncGovernance() {
  const { data } = await API.post('/governance/sync', null, { timeout: GOVERNANCE_TIMEOUT })
  return data
}

export async function searchDecisions(params = {}) {
  // params: { patient, medicine, disease, prediction, status, model_version,
  //           dataset_version, min_confidence, date_from, date_to, page, page_size }
  const { data } = await API.get('/governance/decisions', {
    params: _clean(params), timeout: GOVERNANCE_TIMEOUT,
  })
  return data
}

export async function getDecisionTrace(traceId) {
  const { data } = await API.get(`/governance/decisions/${encodeURIComponent(traceId)}`)
  return data
}

export async function getDecisionExplanation(traceId) {
  const { data } = await API.get(`/governance/decisions/${encodeURIComponent(traceId)}/explanation`)
  return data
}

export async function getDecisionConfidence(traceId) {
  const { data } = await API.get(`/governance/decisions/${encodeURIComponent(traceId)}/confidence`)
  return data
}

export async function getDecisionPipeline(traceId) {
  const { data } = await API.get(`/governance/decisions/${encodeURIComponent(traceId)}/pipeline`)
  return data
}

export async function getAuditLogs(params = {}) {
  // params: { user, api, method, status_code, errors_only, date_from, date_to, page, page_size }
  const { data } = await API.get('/governance/audit-logs', { params: _clean(params) })
  return data
}

export async function getGovernanceModels() {
  const { data } = await API.get('/governance/models')
  return data
}

export async function registerGovernanceModel(payload) {
  const { data } = await API.post('/governance/models', payload)
  return data
}

export async function getGovernanceDatasets() {
  const { data } = await API.get('/governance/datasets')
  return data
}

export async function registerGovernanceDataset(payload) {
  const { data } = await API.post('/governance/datasets', payload)
  return data
}

/** Absolute URL of an export (kind: 'audit-logs' | 'decisions'; fmt: 'csv'|'json'|'pdf'). */
export function governanceExportUrl(kind, fmt) {
  return `${API.defaults.baseURL}/governance/${kind}/export?fmt=${fmt}`
}

/** Fetch an export as a Blob for a robust client-side download. */
export async function fetchGovernanceExport(kind, fmt) {
  const res = await API.get(`/governance/${kind}/export`, {
    params: { fmt }, responseType: 'blob', timeout: GOVERNANCE_TIMEOUT,
  })
  return res.data
}
