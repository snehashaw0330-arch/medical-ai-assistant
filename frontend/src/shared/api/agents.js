import { API } from './client'

// ---------------- Multi-Agent Medical Copilot ----------------
// Orchestrates the existing capabilities (OCR, disease, interactions, RAG,
// clinical, reports) as collaborating agents. A run executes in the background;
// the AI Agent Monitor page polls `getAgentRun` for live pipeline state.
const AGENT_TIMEOUT = 300_000 // 5 min — the full pipeline can include OCR

export async function startAgentRun({ file, symptoms, medicines, text, age, gender, diagnosis } = {}) {
  const form = new FormData()
  if (file) form.append('file', file)
  if (symptoms) form.append('symptoms', Array.isArray(symptoms) ? symptoms.join(',') : symptoms)
  if (medicines) form.append('medicines', Array.isArray(medicines) ? medicines.join(',') : medicines)
  if (text) form.append('text', text)
  if (age) form.append('age', age)
  if (gender) form.append('gender', gender)
  if (diagnosis) form.append('diagnosis', diagnosis)
  const { data } = await API.post('/agents/run', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: AGENT_TIMEOUT,
  })
  return data // { run_id, status, task_type }
}

export async function getAgentRun(runId) {
  const { data } = await API.get(`/agents/runs/${runId}`)
  return data
}

export async function getAgentRuns(limit = 20) {
  const { data } = await API.get('/agents/runs', { params: { limit } })
  return data
}

export async function getAgentRegistry() {
  const { data } = await API.get('/agents/registry')
  return data
}

// Per-agent liveness probes (RAG index, model files, datasets, OCR stack, …)
// plus an aggregate status — powers the Agent Status Dashboard.
export async function getAgentHealth(force = false) {
  const { data } = await API.get('/agents/health', { params: force ? { force: true } : undefined })
  return data
}
