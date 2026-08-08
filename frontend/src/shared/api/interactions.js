import { API } from './client'

// ---------------- Drug interaction analysis ----------------
// Drug–drug interactions + per-drug warnings. Analysis also runs automatically
// after OCR (the OCR result carries `drug_interactions`), but this lets the UI
// re-check an edited medicine list on demand. RAG enrichment can be slow, so we
// use a longer timeout than the default fast endpoints.
const INTERACTIONS_TIMEOUT = 120_000 // 2 min (RAG enrichment can be slow)

export async function checkInteractions(medicines, { includeRag = true } = {}) {
  const { data } = await API.post(
    '/interactions/check',
    { medicines, include_rag: includeRag },
    { timeout: INTERACTIONS_TIMEOUT },
  )
  return data
}

export async function getInteractionHistory(params = {}) {
  // params: { page, page_size }
  const { data } = await API.get('/interactions/history', { params })
  return data
}

export async function getInteractionReport(id) {
  const { data } = await API.get(`/interactions/${id}`)
  return data
}
