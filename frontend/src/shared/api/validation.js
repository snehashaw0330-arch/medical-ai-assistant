import { API } from './client'

// ---------------- Prescription Validation ----------------
// Deterministic prescription-safety validation (duplicates, missing dosing info,
// unsafe abbreviations, suspicious / low-confidence names, prescription errors).
// Validation also runs automatically after OCR (the OCR result carries
// `validation_report`), but this endpoint lets the UI re-validate an edited
// medicine list on demand. The checks are fast, so the default timeout is fine.
export async function checkValidation({ medicines, rawText = '', fields = null, overallConfidence = null, persist = false } = {}) {
  const { data } = await API.post('/validation/check', {
    medicines,
    raw_text: rawText,
    fields,
    overall_confidence: overallConfidence,
    persist,
  })
  return data
}

export async function getValidationHistory(params = {}) {
  // params: { page, page_size }
  const { data } = await API.get('/validation/history', { params })
  return data
}

export async function getValidationReport(id) {
  const { data } = await API.get(`/validation/${id}`)
  return data
}
