import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ThemeProvider } from '@/context/ThemeContext'
import App from '@/App'

/**
 * Mount the real application at `path`, with the real router and the real
 * layout — only the network is faked. A route test that stubbed the layout
 * would not be able to catch the failures these tests exist to catch
 * (nav pointing at a route that no longer exists, a page that throws on mount).
 */
export function renderRoute(path) {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </ThemeProvider>,
  )
}

/** Marker text from pages/NotFound.jsx — how we detect an unresolved route. */
export const NOT_FOUND_MARKER = '404'
