import clsx from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Conditional className join, with conflicting Tailwind utilities resolved.
 *
 * clsx alone only concatenates, so a component's `className` prop and its
 * variant classes both survive onto the element and the winner is decided by
 * order in the generated stylesheet — not by the order they were written. That
 * made overrides silently unreliable: `<Button className="bg-white text-primary">`
 * rendered white-on-white, because `.text-primary-foreground` from the variant
 * happens to be emitted 35 bytes later than `.text-primary`.
 *
 * twMerge drops the earlier of any two conflicting utilities, so the last one
 * written — the caller's `className` — reliably wins.
 */
export function cn(...args) {
  return twMerge(clsx(...args))
}

/** Map a 0..100 confidence to a semantic color token. */
export function confidenceColor(pct) {
  if (pct >= 70) return 'var(--success)'
  if (pct >= 40) return 'var(--warning)'
  return 'var(--danger)'
}

/** Title-case a snake_case / lowercase string for display. */
export function titleCase(str = '') {
  return str
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Convert a 0..1 confidence to a rounded 0..100 percentage. */
export const pct = (v) => Math.round((v || 0) * 100)

/** Human-readable frequency for a medicine row (expanded > raw > none). */
export const freqText = (m) => m.frequency_expanded || titleCase(m.frequency || '') || null

export function formatDate(iso) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    })
  } catch {
    return iso
  }
}

/** True when the request was aborted by the user (AbortController). */
export function isCanceled(err) {
  return err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError'
}

/** Extract a friendly, human message from an axios error. */
export function errorMessage(err, fallback = 'Something went wrong') {
  // Prefer the backend's own message (FastAPI returns {detail: ...}).
  const backend = err?.response?.data?.detail || err?.response?.data?.error
  if (backend) return typeof backend === 'string' ? backend : JSON.stringify(backend)

  if (isCanceled(err)) return 'Request canceled.'
  if (err?.code === 'ECONNABORTED' || err?.code === 'ETIMEDOUT') {
    return 'The analysis is taking longer than expected. Please try again, or use a smaller / clearer image.'
  }
  if (err?.code === 'ERR_NETWORK') {
    return 'Cannot reach the server. Make sure the backend is running.'
  }
  return err?.message || fallback
}
