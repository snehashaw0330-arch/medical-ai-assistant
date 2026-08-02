import { lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import AppLayout from './layout/AppLayout'
import { LEGACY_REDIRECTS, ROUTES } from './app/routes'

const NotFound = lazy(() => import('./pages/NotFound'))

/**
 * The router is generated from `app/routes.jsx` rather than hand-written, so the
 * sidebar, the topbar title, the breadcrumb and the command palette cannot
 * drift from what is actually routable.
 */
export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        {ROUTES.map(({ to, element: Element }) =>
          to === '/' ? (
            <Route key={to} index element={<Element />} />
          ) : (
            <Route key={to} path={to.slice(1)} element={<Element />} />
          ),
        )}

        {/* Pre-Phase-2 flat URLs. Kept indefinitely: they are in bookmarks and
            in links already shared. */}
        {Object.entries(LEGACY_REDIRECTS).map(([from, target]) => (
          <Route
            key={from}
            path={from.slice(1)}
            element={<Navigate to={target} replace />}
          />
        ))}

        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
