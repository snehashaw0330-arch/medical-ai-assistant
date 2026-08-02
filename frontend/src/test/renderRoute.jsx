import { expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient } from '@tanstack/react-query'
import AppProviders from '@/app/providers'
import App from '@/App'

/** A client that fails fast and keeps nothing between tests. */
function testQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  })
}

/**
 * Mount the real application at `path`, with the real providers, router and
 * layout — only the network is faked. Stubbing the layout would defeat the
 * purpose: these tests exist to catch nav pointing at a dead route, a page that
 * throws on mount, and a lazy chunk that never resolves.
 */
export function renderRoute(path) {
  return render(
    <AppProviders client={testQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </AppProviders>,
  )
}

/**
 * Wait for the lazily-loaded page to actually be on screen.
 *
 * Without this, code-splitting would quietly gut the route tests: every
 * assertion would run against the Suspense fallback and pass no matter how
 * broken the page behind it was.
 */
export async function waitForRoute() {
  await waitFor(() =>
    expect(screen.queryByTestId('route-loading')).not.toBeInTheDocument(),
  )
}

/** Marker text from pages/NotFound.jsx — how we detect an unresolved route. */
export const NOT_FOUND_MARKER = '404'
