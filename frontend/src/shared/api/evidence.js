import { API } from './client'

// ---------------- Evidence-Based Medical Response Engine ----------------
// Every response is grounded in evidence retrieved from the RAG knowledge base
// before generation: retrieve -> rerank -> cite -> generate. Returns the AI
// response, numbered citations, retrieved chunks and a confidence score.
// Retrieval + reranking + generation can be slow, so use a longer timeout.
const EVIDENCE_TIMEOUT = 120_000 // 2 min

export async function queryEvidence(payload) {
  // payload: { query, top_k, rerank_top_k, min_similarity, use_reranking, persist }
  const { data } = await API.post('/evidence/query', payload, { timeout: EVIDENCE_TIMEOUT })
  return data
}

export async function chatEvidence(payload) {
  // payload: { message, session_id, top_k, rerank_top_k, min_similarity, use_reranking, persist }
  const { data } = await API.post('/evidence/chat', payload, { timeout: EVIDENCE_TIMEOUT })
  return data
}

export async function getEvidenceHistory(params = {}) {
  // params: { page, page_size }
  const { data } = await API.get('/evidence/history', { params })
  return data
}

export async function getEvidenceRecord(id) {
  const { data } = await API.get(`/evidence/${id}`)
  return data
}

export async function clearEvidenceHistory() {
  const { data } = await API.delete('/evidence/history')
  return data
}
