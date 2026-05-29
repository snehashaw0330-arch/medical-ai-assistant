import clsx from 'clsx'

/** Conditional className join. */
export function cn(...args) {
  return clsx(...args)
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

/** Extract a friendly message from an axios error. */
export function errorMessage(err, fallback = 'Something went wrong') {
  return (
    err?.response?.data?.detail ||
    err?.response?.data?.error ||
    err?.message ||
    fallback
  )
}
