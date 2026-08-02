import { API } from './client'

// ---------------- Dataset evaluation ----------------
// Batch OCR evaluation runs in the background on the server; the UI starts a
// job, polls its status for live progress, and downloads the final report.
export async function getDatasetInfo(dataset) {
  const { data } = await API.get('/ocr/dataset-info', {
    params: dataset ? { dataset } : undefined,
  })
  return data
}

export async function startDatasetEvaluation({ dataset, limit } = {}) {
  const { data } = await API.post('/ocr/evaluate-dataset', null, {
    params: { ...(dataset ? { dataset } : {}), ...(limit ? { limit } : {}) },
  })
  return data
}

export async function getDatasetEvaluationStatus(jobId) {
  const { data } = await API.get(`/ocr/evaluate-dataset/status/${jobId}`)
  return data
}

/** Absolute URL of the downloadable JSON report (used by an <a> / window.open). */
export function datasetReportUrl(jobId) {
  return `${API.defaults.baseURL}/ocr/evaluate-dataset/report/${jobId}`
}
