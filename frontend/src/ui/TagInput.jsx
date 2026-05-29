import { useId, useMemo, useRef, useState } from 'react'
import { Plus, X, Search } from 'lucide-react'
import { cn, titleCase } from '@/lib/utils'

/** Normalize a free-text token: lowercase, spaces for separators, trimmed. */
export function normalizeToken(s) {
  return s.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Accessible multi-value tag/chip input with autocomplete.
 *
 * Commits a chip on: Enter, comma, paste (comma/newline separated), or picking
 * a suggestion (mouse or keyboard). Backspace on empty input removes the last
 * chip. Duplicates are ignored (case/separator-insensitive). `value` is an
 * array of normalized strings; `onChange` receives the next array.
 */
export default function TagInput({
  value,
  onChange,
  suggestions = [],
  placeholder = 'Type and press Enter…',
  disabled = false,
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const inputRef = useRef(null)
  const listId = useId()

  const selectedSet = useMemo(
    () => new Set(value.map(normalizeToken)),
    [value],
  )

  const filtered = useMemo(() => {
    const q = normalizeToken(query)
    if (!q) return []
    return suggestions
      .filter((s) => {
        const ns = normalizeToken(s)
        return ns.includes(q) && !selectedSet.has(ns)
      })
      .slice(0, 8)
  }, [query, suggestions, selectedSet])

  const addTokens = (raw) => {
    const parts = raw.split(/[,\n]/).map(normalizeToken).filter(Boolean)
    if (!parts.length) return
    const seen = new Set(value.map(normalizeToken))
    const next = [...value]
    for (const p of parts) {
      if (!seen.has(p)) {
        seen.add(p)
        next.push(p)
      }
    }
    if (next.length !== value.length) onChange(next)
  }

  const commit = () => {
    if (active >= 0 && filtered[active]) addTokens(filtered[active])
    else if (query.trim()) addTokens(query)
    setQuery('')
    setActive(-1)
    setOpen(false)
  }

  const remove = (tok) =>
    onChange(value.filter((v) => normalizeToken(v) !== normalizeToken(tok)))

  const onKeyDown = (e) => {
    switch (e.key) {
      case 'Enter':
      case ',':
        e.preventDefault()
        commit()
        break
      case 'Backspace':
        if (!query && value.length) {
          e.preventDefault()
          onChange(value.slice(0, -1))
        }
        break
      case 'ArrowDown':
        if (filtered.length) {
          e.preventDefault()
          setOpen(true)
          setActive((i) => Math.min(i + 1, filtered.length - 1))
        }
        break
      case 'ArrowUp':
        if (filtered.length) {
          e.preventDefault()
          setActive((i) => Math.max(i - 1, 0))
        }
        break
      case 'Escape':
        setOpen(false)
        setActive(-1)
        break
      default:
        break
    }
  }

  const onPaste = (e) => {
    const text = e.clipboardData.getData('text')
    if (text && /[,\n]/.test(text)) {
      e.preventDefault()
      addTokens(text)
      setQuery('')
    }
  }

  return (
    <div>
      <div
        className={cn(
          'flex flex-wrap items-center gap-2 rounded-xl border border-border bg-background p-2 transition-colors focus-within:border-primary/60',
          disabled && 'opacity-60',
        )}
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((tok) => (
          <span
            key={tok}
            className="animate-pop-in inline-flex items-center gap-1.5 rounded-full bg-primary-soft py-1 pl-3 pr-1.5 text-sm font-medium text-primary"
          >
            {titleCase(tok)}
            <button
              type="button"
              aria-label={`Remove ${tok}`}
              onClick={(e) => {
                e.stopPropagation()
                remove(tok)
              }}
              className="grid h-5 w-5 place-items-center rounded-full hover:bg-primary/20"
            >
              <X size={12} />
            </button>
          </span>
        ))}

        <div className="flex min-w-[8rem] flex-1 items-center gap-1.5">
          <Search size={16} className="shrink-0 text-muted" />
          <input
            ref={inputRef}
            value={query}
            disabled={disabled}
            onChange={(e) => {
              setQuery(e.target.value)
              setOpen(true)
              setActive(-1)
            }}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 120)}
            role="combobox"
            aria-expanded={open && filtered.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={
              active >= 0 ? `${listId}-opt-${active}` : undefined
            }
            placeholder={value.length ? 'Add another…' : placeholder}
            className="h-8 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted"
          />
        </div>
      </div>

      {open && filtered.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="relative z-10 mt-1 max-h-64 overflow-auto rounded-xl border border-border bg-surface p-1 shadow-lg"
        >
          {filtered.map((s, i) => (
            <li
              key={s}
              id={`${listId}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault()
                addTokens(s)
                setQuery('')
                setActive(-1)
                setOpen(false)
                inputRef.current?.focus()
              }}
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm',
                i === active ? 'bg-surface-2 text-foreground' : 'text-foreground hover:bg-surface-2',
              )}
            >
              <Plus size={14} className="text-primary" /> {titleCase(s)}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
