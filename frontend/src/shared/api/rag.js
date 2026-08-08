import { API, OCR_TIMEOUT } from './client'

// ---------------- RAG / Knowledge Base ----------------
// Retrieval-augmented Q&A over the medical knowledge base. Indexing/generation
// can be slow, so these use a longer timeout than the default fast endpoints.
const RAG_TIMEOUT = 120_000 // 2 min

export async function getRagStatus() {
  const { data } = await API.get('/rag/status')
  return data
}

export async function rebuildRagIndex() {
  const { data } = await API.post('/rag/index', null, { timeout: RAG_TIMEOUT })
  return data
}

export async function queryKnowledgeBase(question, topK) {
  const { data } = await API.post(
    '/rag/query',
    { question, top_k: topK ?? null },
    { timeout: RAG_TIMEOUT },
  )
  return data
}

export async function getRagMedicineInfo(medicines) {
  const { data } = await API.post(
    '/rag/medicine-info',
    { medicines },
    { timeout: RAG_TIMEOUT },
  )
  return data
}

export async function uploadKnowledgeDoc(file, { reindex = true } = {}) {
  const form = new FormData()
  form.append('file', file)
  const { data } = await API.post('/rag/upload', form, {
    params: { reindex },
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: RAG_TIMEOUT,
  })
  return data
}

// OCR an uploaded prescription, then retrieve RAG info for every medicine found.
export async function analyzePrescriptionRag(file, { signal } = {}) {
  const form = new FormData()
  form.append('file', file)
  const { data } = await API.post('/rag/prescription', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: OCR_TIMEOUT,
    signal,
  })
  return data
}
