import { Children, isValidElement } from 'react'
import App from '@/App'

/**
 * Collect every concrete path the router can serve, by walking the element tree
 * App() returns.
 *
 * Deliberately introspects React elements rather than parsing the source or
 * duplicating the list in the test: a route added, renamed or deleted shows up
 * here automatically, which is the whole point of an inventory test. Survives
 * the routes becoming lazy, since `<Route path element>` keeps its shape.
 */
function walk(node, base, out) {
  Children.forEach(node, (child) => {
    if (!isValidElement(child)) return
    const { path, index, children } = child.props ?? {}

    if (index) {
      out.push(base || '/')
      return
    }

    const hasPath = typeof path === 'string'
    const full = hasPath ? `${base}/${path}`.replace(/\/{2,}/g, '/') : base

    if (children) walk(children, full, out)
    else if (hasPath) out.push(full)
  })
  return out
}

/** All servable paths, e.g. ['/', '/predict', ..., '/*']. */
export function collectRoutePaths() {
  return walk(App().props.children, '', [])
}

/** Servable paths excluding the catch-all — the ones that must render a page. */
export function collectRealRoutePaths() {
  return collectRoutePaths().filter((p) => !p.includes('*'))
}
