import { API } from './client'

// ---------------- Medical Document Intelligence ----------------
// Generalizes intake beyond prescriptions: Blood Test / CBC / LFT / KFT /
// Lipid Profile / Thyroid reports, Discharge Summaries and Medical
// Certificates. Detect type -> extract text -> parse structured data -> RAG
// -> clinical summary -> highlight abnormal findings -> AI explanation.
// Uses OCR under the hood for images/scanned PDFs, so give it the same long
// timeout as the OCR endpoints.
const DOCUMENT_TIMEOUT = 300_000 // 5 min

export async function analyzeDocument(file, { documentType, provider, onProgress, signal } = {}) {
  const form = new FormData()
  form.append('file', file)
  const params = {}
  if (documentType && documentType !== 'auto') params.document_type = documentType
  if (provider) params.provider = provider
  const { data } = await API.post('/documents/analyze', form, {
    params,
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: DOCUMENT_TIMEOUT,
    signal,
    onUploadProgress: (e) => {
      if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100))
    },
  })
  return data
}

export async function getDocumentHistory(params = {}) {
  // params: { q, document_type, status, date_from, date_to, sort, page, page_size }
  const clean = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  )
  const { data } = await API.get('/documents/history', { params: clean })
  return data
}

export async function getDocumentStats() {
  const { data } = await API.get('/documents/stats')
  return data
}

export async function getDocument(id) {
  const { data } = await API.get(`/documents/${id}`)
  return data
}

export async function deleteDocumentRecord(id) {
  const { data } = await API.delete(`/documents/${id}`)
  return data
}

export async function clearDocumentHistory() {
  const { data } = await API.delete('/documents')
  return data
}

/** Absolute URL of a record's retained original file (for <img> / <a>). */
export function documentImageUrl(id) {
  return `${API.defaults.baseURL}/documents/${id}/image`
}

/** Fetch the structured JSON report as a Blob for a robust client-side download. */
export async function fetchDocumentReportBlob(id) {
  const res = await API.get(`/documents/${id}/json`, { responseType: 'blob', timeout: 60_000 })
  return res.data
}
