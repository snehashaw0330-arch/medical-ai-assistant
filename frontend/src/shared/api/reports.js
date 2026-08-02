import { API } from './client'

// ---------------- Medical Report Generator ----------------
// Durable, exportable reports (PDF / JSON / HTML) assembled from an OCR analysis.
// A report is also generated automatically after every OCR run (the OCR result
// carries `report_id`); these endpoints power the Medical Reports page + viewer.
export async function generateReport(payload) {
  // payload: { ocr_result, filename, processing_time, source_record_id,
  //            image_data_url, persist }
  const { data } = await API.post('/reports/generate', payload, { timeout: 60_000 })
  return data
}

export async function getReports(params = {}) {
  // params: { q, patient, date_from, date_to, page, page_size }
  const clean = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  )
  const { data } = await API.get('/reports', { params: clean })
  return data
}

export async function getReportStats() {
  const { data } = await API.get('/reports/stats')
  return data
}

export async function getReport(id) {
  const { data } = await API.get(`/reports/${id}`)
  return data
}

export async function deleteReport(id) {
  const { data } = await API.delete(`/reports/${id}`)
  return data
}

/** Absolute URL of a report's retained prescription image (for <img> / fetch). */
export function reportImageUrl(id) {
  return `${API.defaults.baseURL}/reports/${id}/image`
}

/** Absolute URL of a report export (format: 'pdf' | 'json' | 'html'). */
export function reportExportUrl(id, format) {
  return `${API.defaults.baseURL}/reports/${id}/${format}`
}

/**
 * Fetch a report export as a Blob (robust cross-origin download). Returns the
 * Blob so the caller can trigger a client-side save with the right filename.
 */
export async function fetchReportBlob(id, format) {
  const params = format === 'html' ? { download: 1 } : undefined
  const res = await API.get(`/reports/${id}/${format}`, {
    responseType: 'blob',
    timeout: 60_000,
    params,
  })
  return res.data
}
