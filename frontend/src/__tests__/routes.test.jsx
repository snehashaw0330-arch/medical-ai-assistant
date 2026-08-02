import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { buildClientMock } from '@/test/apiMock'
import { collectRealRoutePaths, collectRoutePaths } from '@/test/routeInventory'
import { NOT_FOUND_MARKER, renderRoute, waitForRoute } from '@/test/renderRoute'

vi.mock('@/shared/api/client', () => buildClientMock())

/**
 * The safety net for the IA overhaul. Everything downstream — regrouping the
 * sidebar, merging pages, swapping the data layer — is allowed to move code
 * freely as long as these hold: every route still resolves, and every route
 * still mounts.
 */
describe('route inventory', () => {
  const routes = collectRealRoutePaths()

  it('serves the expected number of routes', () => {
    // Guards against a route being silently dropped during a refactor.
    // Update deliberately when routes are intentionally added or merged.
    expect(routes).toHaveLength(27)
  })

  it('has a catch-all route', () => {
    expect(collectRoutePaths()).toContain('/*')
  })

  it('has no duplicate paths', () => {
    expect(new Set(routes).size).toBe(routes.length)
  })

  it.each(routes)('%s mounts and resolves to a page', async (path) => {
    renderRoute(path)

    // The app chrome rendered at all.
    expect(screen.getByRole('banner')).toBeInTheDocument()

    // Wait for the lazy chunk, or every assertion below would be checking the
    // Suspense fallback instead of the page.
    await waitForRoute()

    // The page mounted rather than tripping the per-route error boundary.
    // Without this the boundary would swallow a page that throws and this
    // test would go green on a broken app.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    // The path resolved to a real page rather than falling through to 404.
    expect(screen.queryByText(NOT_FOUND_MARKER)).not.toBeInTheDocument()

    // Exactly one main landmark. A page nesting its own <main> inside the
    // layout's is an accessibility violation, and this is what caught
    // CopilotWorkspace doing precisely that.
    const [main, ...extra] = screen.getAllByRole('main')
    expect(extra).toHaveLength(0)

    // The page rendered something of its own, not an empty shell.
    expect(main).not.toBeEmptyDOMElement()
  })

  it('renders the 404 page for an unknown path', async () => {
    renderRoute('/no-such-page-exists')
    expect(await screen.findByText(NOT_FOUND_MARKER)).toBeInTheDocument()
  })
})
