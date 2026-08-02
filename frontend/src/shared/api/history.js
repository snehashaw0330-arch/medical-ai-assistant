import { API } from './client'

// ---------------- Prescription OCR history ----------------
// Persistent server-side history of every OCR analysis.
export async function getHistory(params = {}) {
  // params: { q, medicine, status, date_from, date_to, sort, page, page_size }
  const clean = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  )
  const { data } = await API.get('/history', { params: clean })
  return data
}

export async function getHistoryStats() {
  const { data } = await API.get('/history/stats')
  return data
}

export async function getHistoryMedicines() {
  const { data } = await API.get('/history/medicines')
  return data.medicines ?? []
}

export async function getHistoryItem(id) {
  const { data } = await API.get(`/history/${id}`)
  return data
}

export async function deleteHistoryItem(id) {
  const { data } = await API.delete(`/history/${id}`)
  return data
}

export async function clearHistory() {
  const { data } = await API.delete('/history')
  return data
}

/** Absolute URL of a record's retained prescription image (for <img> / fetch). */
export function historyImageUrl(id) {
  return `${API.defaults.baseURL}/history/${id}/image`
}
