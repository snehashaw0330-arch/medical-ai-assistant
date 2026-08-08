import { API, OCR_TIMEOUT } from './client'

// ---------------- Prescription OCR ----------------
// Slow by nature. Uses OCR_TIMEOUT (5 min) and accepts an AbortController
// `signal` so the UI can cancel on user request (and ONLY on user request).
export async function extractPrescription(file, { provider, onProgress, signal } = {}) {
  const form = new FormData()
  form.append('file', file)
  const { data } = await API.post('/ocr/extract-prescription', form, {
    params: provider ? { provider } : undefined,
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: OCR_TIMEOUT,
    signal,
    onUploadProgress: (e) => {
      if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100))
    },
  })
  return data
}

// ---------------- Image quality assessment ----------------
// Fast OpenCV analysis that runs BEFORE OCR so the user can fix a bad photo.
// Returns { overall_score, rating, passed, threshold, metrics, subscores,
// recommendations, warnings }.
export async function assessImageQuality(file, { signal } = {}) {
  const form = new FormData()
  form.append('file', file)
  const { data } = await API.post('/ocr/image-quality', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    signal,
  })
  return data
}
