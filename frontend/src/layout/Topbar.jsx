import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Bell, ChevronRight, Menu, Moon, Search, Sun, User } from 'lucide-react'
import { useTheme } from '@/context/ThemeContext'
import { findRoute } from '@/app/routes'

export default function Topbar({ onMenu, onOpenPalette }) {
  const { theme, toggle } = useTheme()
  const { pathname } = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)

  // Resolved from the route table, not by scanning a parallel nav array.
  const route = findRoute(pathname)

  useEffect(() => {
    if (!menuOpen) return
    const onDocClick = (e) => {
      if (!menuRef.current?.contains(e.target)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [menuOpen])

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-border bg-surface/80 px-4 backdrop-blur-md lg:px-8">
      <div className="flex min-w-0 items-center gap-3">
        <button
          className="rounded-lg p-2 text-muted hover:bg-surface-2 lg:hidden"
          onClick={onMenu}
          aria-label="Open menu"
        >
          <Menu size={20} />
        </button>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold text-foreground">
            {route?.label ?? 'MediSense'}
          </h1>
          {route?.group ? (
            <nav aria-label="Breadcrumb" className="hidden sm:block">
              <ol className="flex items-center gap-1 text-xs text-muted">
                <li>{route.group.label}</li>
                <li aria-hidden="true">
                  <ChevronRight size={12} />
                </li>
                <li aria-current="page">{route.label}</li>
              </ol>
            </nav>
          ) : (
            <p className="hidden text-xs text-muted sm:block">
              Welcome back — here’s your clinical workspace
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <button
          onClick={onOpenPalette}
          className="rounded-xl p-2.5 text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
          aria-label="Search pages"
        >
          <Search size={19} />
        </button>
        <button
          className="relative rounded-xl p-2.5 text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
          aria-label="Notifications"
        >
          <Bell size={19} />
          <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-danger" />
        </button>
        <button
          onClick={toggle}
          className="rounded-xl p-2.5 text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}
        </button>

        {/* Profile lives here rather than in the sidebar: it is account
            settings, not a clinical destination. */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Account menu"
            aria-expanded={menuOpen}
            className="grid h-9 w-9 place-items-center rounded-full bg-primary-soft text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
          >
            <User size={17} />
          </button>
          {menuOpen && (
            <div className="absolute right-0 mt-2 w-44 overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-xl">
              <Link
                to="/profile"
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-surface-2"
              >
                <User size={15} /> Profile
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
