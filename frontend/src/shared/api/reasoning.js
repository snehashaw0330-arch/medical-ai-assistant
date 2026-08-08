import { API } from './client'

// ---------------- Clinical Reasoning Platform ----------------
// Enterprise, step-by-step AI clinical reasoning. Instead of returning an answer
// directly, the pipeline chains OCR -> medicine detection/validation -> drug
// interactions -> disease prediction -> RAG evidence -> clinical rules ->
// differential -> confidence -> recommendation, and shows every step. The
// disease model + RAG can be slow, so use a longer timeout than the fast defaults.
const REASONING_TIMEOUT = 180_000 // 3 min (full pipeline: disease model + RAG)

export async function analyzeReasoning(payload) {
  // payload: { medicines, symptoms, disease, diagnosis, ocr_text, age, gender,
  //            include_rag, run_disease_prediction, top_k, use_cache, source_record_id }
  const { data } = await API.post('/reasoning/analyze', payload, {
    timeout: REASONING_TIMEOUT,
  })
  return data
}

export async function getReasoningPipeline() {
  const { data } = await API.get('/reasoning/pipeline')
  return data.steps ?? []
}

export async function getReasoningHistory(params = {}) {
  // params: { page, page_size }
  const { data } = await API.get('/reasoning/history', { params })
  return data
}

export async function getReasoningStats() {
  const { data } = await API.get('/reasoning/stats')
  return data
}

export async function getReasoningReport(id) {
  const { data } = await API.get(`/reasoning/${id}`)
  return data
}

export async function clearReasoningHistory() {
  const { data } = await API.delete('/reasoning/history')
  return data
}
