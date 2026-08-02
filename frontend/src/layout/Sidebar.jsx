import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { Activity, ChevronDown, Search, ShieldCheck, X } from 'lucide-react'
import { NAV_TREE, findRoute } from '@/app/routes'
import { cn } from '@/lib/utils'

const STORAGE_KEY = 'medisense-sidebar-groups'

/**
 * Explicit user open/closed choices, keyed by group id. Anything absent falls
 * back to "open only if it contains the current page" — groups start *closed*,
 * because the compaction is only real if the resting state is seven rows.
 * Defaulting to open would put all 26 destinations back on screen with
 * disclosure triangles added.
 */
function loadOverrides() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  } catch {
    return {}
  }
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-2">
      <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-primary to-accent text-white shadow-lg shadow-primary/30">
        <Activity size={22} />
      </span>
      <div>
        <p className="text-lg font-bold leading-tight text-foreground">MediSense</p>
        <p className="text-[11px] font-medium text-muted">AI Medical Assistant</p>
      </div>
    </div>
  )
}

const linkClass = ({ isActive }) =>
  cn(
    'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
    isActive
      ? 'bg-primary text-primary-foreground shadow-sm shadow-primary/30'
      : 'text-muted hover:bg-surface-2 hover:text-foreground',
  )

function Group({ group, isActive, isOpen, onToggle, onNavigate }) {
  const Icon = group.icon

  return (
    <div>
      <button
        type="button"
        onClick={() => onToggle(group.id)}
        aria-expanded={isOpen}
        className={cn(
          'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
          isActive && !isOpen
            ? 'bg-primary-soft text-primary'
            : 'text-muted hover:bg-surface-2 hover:text-foreground',
        )}
      >
        <Icon size={19} />
        <span className="flex-1 text-left">{group.label}</span>
        <ChevronDown
          size={15}
          className={cn('transition-transform', !isOpen && '-rotate-90')}
        />
      </button>

      {isOpen && (
        <div className="mt-0.5 space-y-0.5 border-l border-border pl-3 ml-5">
          {group.items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={onNavigate}
              className={linkClass}
            >
              <item.icon size={16} />
              {item.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Sidebar({ open, onClose, onOpenPalette }) {
  const { pathname } = useLocation()
  const [overrides, setOverrides] = useState(loadOverrides)

  const activeGroupId = findRoute(pathname)?.group?.id ?? null

  // Derived, not stored: a group is open if the user said so, and otherwise
  // only when it contains the current page. Deriving it means deep-linking into
  // a group opens it without an effect having to write state during render —
  // the earlier version did exactly that and cost a second render on every
  // navigation.
  const isOpen = (id) => overrides[id] ?? id === activeGroupId

  const toggle = (id) =>
    setOverrides((prev) => ({ ...prev, [id]: !(prev[id] ?? id === activeGroupId) }))

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides))
    } catch {
      /* private mode — expansion state is not worth failing over */
    }
  }, [overrides])

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-border bg-surface p-4 transition-transform lg:static lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex items-center justify-between py-2">
          <Brand />
          <button
            className="rounded-lg p-2 text-muted hover:bg-surface-2 lg:hidden"
            onClick={onClose}
            aria-label="Close menu"
          >
            <X size={20} />
          </button>
        </div>

        <button
          type="button"
          onClick={onOpenPalette}
          className="mt-4 flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm text-muted transition-colors hover:text-foreground"
        >
          <Search size={16} />
          <span className="flex-1 text-left">Search…</span>
          <kbd className="rounded border border-border bg-surface px-1.5 py-0.5 text-[10px] font-medium">
            ⌘K
          </kbd>
        </button>

        <nav className="mt-4 flex-1 space-y-1 overflow-y-auto" aria-label="Main">
          {NAV_TREE.map((node) =>
            node.items ? (
              <Group
                key={node.id}
                group={node}
                isActive={activeGroupId === node.id}
                isOpen={isOpen(node.id)}
                onToggle={toggle}
                onNavigate={onClose}
              />
            ) : (
              <NavLink
                key={node.to}
                to={node.to}
                end={node.end}
                onClick={onClose}
                className={linkClass}
              >
                <node.icon size={19} />
                {node.label}
              </NavLink>
            ),
          )}
        </nav>

        <div className="mt-4 rounded-2xl border border-border bg-surface-2 p-4">
          <div className="flex items-center gap-2 text-success">
            <ShieldCheck size={18} />
            <span className="text-sm font-semibold">HIPAA-aware</span>
          </div>
          <p className="mt-1 text-xs text-muted">
            Decisions are AI-assisted triage aids — always confirm with a
            licensed clinician.
          </p>
        </div>
      </aside>
    </>
  )
}
