import { API } from './client'

// ---------------- AI Hallucination Detection & Evidence Verification ----------------
// Verifies an AI-generated response against retrieved medical evidence: evidence
// coverage, citation strength, hallucination-risk category, confidence, unsupported
// claims and contradictions. Can also generate the answer via RAG then verify it.
// Retrieval + embedding can be slow, so use a longer timeout.
const VERIFICATION_TIMEOUT = 120_000 // 2 min

export async function checkVerification(payload) {
  // payload: { question, response?, evidence?, source_module, top_k,
  //            generate_if_missing, use_cache, persist }
  const { data } = await API.post('/verification/check', payload, { timeout: VERIFICATION_TIMEOUT })
  return data
}

export async function getVerificationHistory(params = {}) {
  // params: { page, page_size }
  const { data } = await API.get('/verification/history', { params })
  return data
}

export async function getVerificationReport(id) {
  const { data } = await API.get(`/verification/${id}`)
  return data
}

export async function clearVerificationHistory() {
  const { data } = await API.delete('/verification/history')
  return data
}
