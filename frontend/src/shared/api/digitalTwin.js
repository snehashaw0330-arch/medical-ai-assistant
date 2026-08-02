import { API } from './client'

// ---------------- Digital Twin ----------------
// A continuously-evolving virtual health profile per patient, aggregated from
// every prior analysis (OCR, disease, medicines, interactions, clinical, reports)
// and enriched with RAG evidence. Building a twin recomputes live + persists a
// snapshot, so allow a longer timeout than the fast defaults.
const TWIN_TIMEOUT = 120_000 // 2 min (aggregation + RAG can be slow)

export async function getDigitalTwinPatients() {
  const { data } = await API.get('/digital-twin/patients')
  return data
}

export async function getDigitalTwin(patientId) {
  const { data } = await API.get(`/digital-twin/${encodeURIComponent(patientId)}`, {
    timeout: TWIN_TIMEOUT,
  })
  return data
}

export async function getDigitalTwinAnalytics() {
  const { data } = await API.get('/digital-twin/analytics')
  return data
}

export async function recalculateDigitalTwin(patientId = null) {
  const { data } = await API.post('/digital-twin/recalculate', { patient_id: patientId }, {
    timeout: TWIN_TIMEOUT,
  })
  return data
}
