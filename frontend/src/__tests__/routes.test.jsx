import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { LEGACY_REDIRECTS, ROUTES } from '@/app/routes'
import { buildClientMock } from '@/test/apiMock'
import { NOT_FOUND_MARKER, renderRoute, waitForRoute } from '@/test/renderRoute'

vi.mock('@/shared/api/client', () => buildClientMock())

/**
 * The safety net for the IA overhaul. Everything downstream — merging pages,
 * swapping the data layer — is allowed to move code freely as long as these
 * hold: every route still resolves, and every route still mounts.
 */
describe('route inventory', () => {
  const paths = ROUTES.map((r) => r.to)

  it('serves the expected number of routes', () => {
    // Guards against a route being silently dropped during a refactor.
    // Update deliberately when routes are intentionally added or merged.
    expect(paths).toHaveLength(27)
  })

  it('has no duplicate paths', () => {
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('gives every route a label, icon and component', () => {
    const incomplete = ROUTES.filter((r) => !r.label || !r.icon || !r.element)
    expect(incomplete.map((r) => r.to)).toEqual([])
  })

  it.each(paths)('%s mounts and resolves to a page', async (path) => {
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

/**
 * Phase 2 restructured every URL into its group. These are the old flat paths;
 * they are in bookmarks and in links already shared, so they must keep working
 * indefinitely.
 */
describe('legacy URL redirects', () => {
  const entries = Object.entries(LEGACY_REDIRECTS)
  const known = new Set(ROUTES.map((r) => r.to))

  it('covers every pre-Phase-2 path', () => {
    expect(entries).toHaveLength(20)
  })

  it('points every redirect at a route that exists', () => {
    const broken = entries.filter(([, target]) => !known.has(target))
    expect(broken).toEqual([])
  })

  it('never redirects a path that is itself routable', () => {
    // A legacy path that is also a live route would shadow the real page.
    const shadowed = entries.filter(([from]) => known.has(from))
    expect(shadowed).toEqual([])
  })

  it.each(entries)('%s still resolves (now %s)', async (from) => {
    renderRoute(from)
    await waitForRoute()
    expect(screen.queryByText(NOT_FOUND_MARKER)).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('main')).not.toBeEmptyDOMElement()
  })
})
