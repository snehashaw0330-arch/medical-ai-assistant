import { API } from './client'

// ---------------- Clinical Decision Support (CDSS) ----------------
// Fuses OCR medicines, disease prediction, drug interactions and RAG into one
// risk-graded clinical report. Analysis also runs automatically after OCR (the
// OCR result carries `clinical_report`), but this endpoint lets the dedicated
// Clinical Decision page and edited-list re-checks run it on demand. Disease
// prediction + RAG can be slow, so use a longer timeout than the fast defaults.
const CLINICAL_TIMEOUT = 120_000 // 2 min (disease model + RAG can be slow)

export async function analyzeClinical(payload) {
  // payload: { medicines, symptoms, disease, diagnosis, age, gender,
  //            include_rag, run_disease_prediction, persist, source_record_id }
  const { data } = await API.post('/clinical/analyze', payload, {
    timeout: CLINICAL_TIMEOUT,
  })
  return data
}

export async function getClinicalHistory(params = {}) {
  // params: { page, page_size }
  const { data } = await API.get('/clinical/history', { params })
  return data
}

export async function getClinicalStats() {
  const { data } = await API.get('/clinical/stats')
  return data
}

export async function getClinicalReport(id) {
  const { data } = await API.get(`/clinical/${id}`)
  return data
}
