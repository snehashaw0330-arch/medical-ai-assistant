import { NavLink, useLocation } from 'react-router-dom'
import { findRoute, tabsFor } from './routes'
import { cn } from '@/lib/utils'

/**
 * Tab bar for destinations made of more than one route.
 *
 * Rendered by the layout from the route table rather than inside each page, so
 * a merged destination needs no page edits and every tab set looks the same.
 * Each tab is a real URL, so deep links and the back button keep working.
 */
export default function RouteTabs() {
  const { pathname } = useLocation()
  const tabs = tabsFor(findRoute(pathname))

  if (tabs.length < 2) return null

  return (
    <nav aria-label="Section" className="mb-5 border-b border-border">
      <ul className="-mb-px flex gap-1">
        {tabs.map((tab) => (
          <li key={tab.to}>
            <NavLink
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                cn(
                  'inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted hover:border-border hover:text-foreground',
                )
              }
            >
              <tab.icon size={16} />
              {tab.tabLabel ?? tab.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
