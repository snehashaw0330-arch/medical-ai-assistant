import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { buildApiMock } from '@/test/apiMock'
import { collectRealRoutePaths, collectRoutePaths } from '@/test/routeInventory'
import { NOT_FOUND_MARKER, renderRoute } from '@/test/renderRoute'

vi.mock('@/lib/api', async (importOriginal) => buildApiMock(importOriginal))

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

    // The path resolved to a real page rather than falling through to 404.
    expect(screen.queryByText(NOT_FOUND_MARKER)).not.toBeInTheDocument()

    // Exactly one main landmark. A page nesting its own <main> inside the
    // layout's is an accessibility violation, and `getAllByRole` here is what
    // caught CopilotWorkspace doing precisely that.
    await waitFor(() => expect(screen.getAllByRole('main')).toHaveLength(1))
  })

  it('renders the 404 page for an unknown path', async () => {
    renderRoute('/no-such-page-exists')
    expect(await screen.findByText(NOT_FOUND_MARKER)).toBeInTheDocument()
  })
})
