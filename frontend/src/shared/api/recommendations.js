import { API } from './client'

// ---------------- Medicine Alternatives & Recommendations ----------------
// Resolves medicines against the dataset, finds generic/brand/similar
// alternatives and enriches with RAG evidence. A report is also generated
// automatically after OCR (the OCR result carries `recommendation_report`);
// these endpoints power the Medicine Recommendations page. Dataset + RAG lookups
// can be slow, so use a longer timeout than the fast defaults.
const RECOMMEND_TIMEOUT = 120_000 // 2 min (dataset + RAG can be slow)

export async function recommendMedicines(payload) {
  // payload: { medicines, include_rag, max_alternatives, persist, source_record_id }
  const { data } = await API.post('/medicine/recommend', payload, {
    timeout: RECOMMEND_TIMEOUT,
  })
  return data
}

export async function getMedicineRecommendations(params = {}) {
  // params: { page, page_size }
  const { data } = await API.get('/medicine/recommendations', { params })
  return data
}

export async function getMedicineRecommendation(id) {
  const { data } = await API.get(`/medicine/recommendations/${id}`)
  return data
}
