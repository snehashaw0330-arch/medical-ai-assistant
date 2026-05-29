import { NavLink } from 'react-router-dom'
import { Activity, X, ShieldCheck } from 'lucide-react'
import { NAV_ITEMS } from './nav'
import { cn } from '@/lib/utils'

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

export default function Sidebar({ open, onClose }) {
  return (
    <>
      {/* Mobile backdrop */}
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

        <nav className="mt-6 flex-1 space-y-1">
          {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={onClose}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground shadow-sm shadow-primary/30'
                    : 'text-muted hover:bg-surface-2 hover:text-foreground',
                )
              }
            >
              <Icon size={19} />
              {label}
            </NavLink>
          ))}
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
