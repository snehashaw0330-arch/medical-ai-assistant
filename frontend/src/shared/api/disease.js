import { API } from './client'

// ---------------- Disease prediction ----------------
export async function predictDisease(symptoms, topK = 3) {
  const { data } = await API.post('/disease/predict', {
    symptoms,
    top_k: topK,
  })
  return data
}

export async function getSymptoms() {
  const { data } = await API.get('/disease/symptoms')
  return data.symptoms ?? []
}

export async function suggestSymptoms(q, limit = 8) {
  const { data } = await API.get('/disease/symptoms/suggest', {
    params: { q, limit },
  })
  return data.suggestions ?? []
}
