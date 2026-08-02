import { API } from './client'

// ---------------- Patient Context ----------------
// Durable, cross-session patient memory: conversation history, OCR/medicine/
// disease/interaction history, AI summaries and follow-up recommendations,
// keyed by the same slugified patient_id used by the Digital Twin.
const PATIENT_CONTEXT_TIMEOUT = 60_000

export async function listPatientContexts() {
  const { data } = await API.get('/patient-context/history')
  return data
}

export async function getPatientContext(patientId) {
  const { data } = await API.get(`/patient-context/${encodeURIComponent(patientId)}`, {
    timeout: PATIENT_CONTEXT_TIMEOUT,
  })
  return data
}

export async function createPatientContext(payload) {
  const { data } = await API.post('/patient-context/create', payload)
  return data
}

export async function deletePatientContext(patientId) {
  const { data } = await API.delete(`/patient-context/${encodeURIComponent(patientId)}`)
  return data
}
