import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CornerDownLeft, Search } from 'lucide-react'
import { ROUTES } from './routes'
import { cn } from '@/lib/utils'

/**
 * ⌘K navigation over the route table.
 *
 * This is what makes a seven-entry sidebar viable: collapsing 27 rows into
 * groups only helps if every destination is still one keystroke away. Searches
 * the group name too, so "gov models" finds Governance › Models.
 */
export default function CommandPalette({ onClose }) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef(null)

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return ROUTES
    const terms = q.split(/\s+/)
    return ROUTES.filter((route) => {
      const haystack = `${route.group?.label ?? ''} ${route.label} ${route.to}`.toLowerCase()
      return terms.every((term) => haystack.includes(term))
    })
  }, [query])

  // Mounted only while open (AppLayout renders it conditionally), so query and
  // cursor start fresh every time without an effect resetting them.
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Escape closes from anywhere, not only while the input has focus — the
  // dialog is modal, so the key should work the moment it is on screen.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const go = (route) => {
    if (!route) return
    navigate(route.to)
    onClose()
  }

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor((c) => Math.min(c + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor((c) => Math.max(c - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      go(results[cursor])
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[10vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search pages"
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Search size={18} className="text-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              // Reset the highlight here rather than in an effect on `query`,
              // which would cost an extra render pass per keystroke.
              setCursor(0)
            }}
            onKeyDown={onKeyDown}
            placeholder="Jump to a page…"
            aria-label="Jump to a page"
            className="h-14 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted"
          />
          <kbd className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted">
            ESC
          </kbd>
        </div>

        <ul className="max-h-80 overflow-y-auto p-2">
          {results.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-muted">
              Nothing matches “{query}”.
            </li>
          )}
          {results.map((route, i) => (
            <li key={route.to}>
              <button
                type="button"
                onClick={() => go(route)}
                onMouseEnter={() => setCursor(i)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors',
                  i === cursor
                    ? 'bg-primary text-primary-foreground'
                    : 'text-foreground hover:bg-surface-2',
                )}
              >
                <route.icon size={16} />
                <span className="flex-1">
                  {route.group && (
                    <span className={cn(i === cursor ? 'opacity-80' : 'text-muted')}>
                      {route.group.label} ›{' '}
                    </span>
                  )}
                  {route.label}
                </span>
                {i === cursor && <CornerDownLeft size={14} />}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
