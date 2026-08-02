import { API } from './client'

// ---------------- AI Medical Copilot Workspace ----------------
// A session-scoped orchestrator that, on every upload, runs the full clinical
// pipeline (OCR → medicines → interactions → disease → RAG evidence → clinical
// decision → AI summary → treatment → follow-up → medical report) and remembers
// the current patient for the session. The full pipeline can include OCR + the
// disease model + RAG, so `copilotAnalyze` uses a long timeout.
const COPILOT_TIMEOUT = 300_000 // 5 min — the full pipeline can include OCR

export async function copilotAnalyze({
  file,
  sessionId,
  medicines,
  symptoms,
  text,
  patientName,
  age,
  gender,
  diagnosis,
  includeRag = true,
  useCache = true,
  signal,
} = {}) {
  const form = new FormData()
  if (file) form.append('file', file)
  if (sessionId) form.append('session_id', sessionId)
  if (medicines) form.append('medicines', Array.isArray(medicines) ? medicines.join(',') : medicines)
  if (symptoms) form.append('symptoms', Array.isArray(symptoms) ? symptoms.join(',') : symptoms)
  if (text) form.append('text', text)
  if (patientName) form.append('patient_name', patientName)
  if (age !== undefined && age !== null && age !== '') form.append('age', age)
  if (gender) form.append('gender', gender)
  if (diagnosis) form.append('diagnosis', diagnosis)
  form.append('include_rag', includeRag)
  form.append('use_cache', useCache)
  const { data } = await API.post('/copilot/analyze', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: COPILOT_TIMEOUT,
    signal,
  })
  return data
}

export async function copilotChat(sessionId, message) {
  const { data } = await API.post(
    '/copilot/chat',
    { session_id: sessionId, message },
    { timeout: 120_000 },
  )
  return data
}

export async function getCopilotContext(sessionId) {
  const { data } = await API.get('/copilot/context', { params: { session_id: sessionId } })
  return data
}

export async function getCopilotHistory(sessionId) {
  const { data } = await API.get('/copilot/history', { params: { session_id: sessionId } })
  return data
}

export async function getCopilotPipeline() {
  const { data } = await API.get('/copilot/pipeline')
  return data.steps ?? []
}
