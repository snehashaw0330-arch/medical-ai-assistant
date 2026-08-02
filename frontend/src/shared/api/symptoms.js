import { API } from './client'

// ---------------- Symptom Checker & Triage ----------------
// Categorized symptom checker: resolves symptoms, runs disease prediction + RAG,
// and returns a triage assessment (possible conditions, urgency, specialist,
// tests, home care, red flags, related documents). Disease inference + RAG can
// be slow, so `analyzeSymptoms` uses a longer timeout than the fast defaults.
const SYMPTOM_TIMEOUT = 120_000 // 2 min (disease model + RAG can be slow)

export async function getSymptomCatalog() {
  const { data } = await API.get('/symptoms/catalog')
  return data
}

export async function suggestSymptomTerms(q, limit = 8) {
  const { data } = await API.get('/symptoms/suggest', { params: { q, limit } })
  return data.suggestions ?? []
}

export async function analyzeSymptoms(payload) {
  // payload: { symptoms, severity, duration, age, gender, include_rag, top_k, persist }
  const { data } = await API.post('/symptoms/analyze', payload, {
    timeout: SYMPTOM_TIMEOUT,
  })
  return data
}

export async function getSymptomHistory(params = {}) {
  // params: { page, page_size }
  const { data } = await API.get('/symptoms/history', { params })
  return data
}

export async function getSymptomAssessment(id) {
  const { data } = await API.get(`/symptoms/${id}`)
  return data
}
