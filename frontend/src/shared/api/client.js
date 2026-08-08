import axios from 'axios'

/**
 * The one axios instance every API module shares.
 *
 * Components never touch axios directly — they import the domain modules in
 * this folder, which are re-exported from `lib/api.js`.
 *
 * Base URL: set VITE_API_URL in a .env file for production; defaults to the
 * local FastAPI server (which has permissive CORS in dev).
 */
// Default timeout is for FAST endpoints (predict, lookups). OCR is slow and
// gets its own long timeout per-request — see OCR_TIMEOUT below.
const DEFAULT_TIMEOUT = 30_000 // 30s
export const OCR_TIMEOUT = 300_000 // 5 min — local handwriting OCR can be slow

export const API = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000',
  timeout: DEFAULT_TIMEOUT,
})
