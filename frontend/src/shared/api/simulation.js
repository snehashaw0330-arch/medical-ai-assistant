import { API } from './client'

// ---------------- AI Medical Simulation Engine ----------------
// A "what-if" engine: simulate treatment/patient changes (dose, replace, remove,
// add; age/weight/pregnancy/renal/hepatic/allergy) across one or more scenarios
// and see projected interactions, disease risk, recommendations, side effects,
// contraindications, RAG evidence and confidence — compared against the baseline.
// Interactions + disease model + RAG can be slow, so use a long timeout.
const SIMULATION_TIMEOUT = 180_000 // 3 min

export async function runSimulation(payload) {
  // payload: { baseline_medicines, patient, scenarios, include_rag, persist,
  //            use_cache, generate_report, source_record_id }
  const { data } = await API.post('/simulation/run', payload, { timeout: SIMULATION_TIMEOUT })
  return data
}

export async function getSimulationHistory(params = {}) {
  // params: { page, page_size }
  const { data } = await API.get('/simulation/history', { params })
  return data
}

export async function getSimulationReport(id) {
  const { data } = await API.get(`/simulation/${id}`)
  return data
}

export async function clearSimulationHistory() {
  const { data } = await API.delete('/simulation/history')
  return data
}
