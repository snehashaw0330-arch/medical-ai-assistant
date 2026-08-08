import { useState } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import { ThemeProvider } from '@/context/ThemeContext'
import { createQueryClient } from './queryClient'
import ErrorBoundary from './ErrorBoundary'

/**
 * Single composition root for everything the app needs in scope. `main.jsx`
 * mounts it and so do the tests, which means a provider added here is
 * automatically present in tests rather than being something test setup has to
 * remember to mirror.
 */
export default function AppProviders({ children, client }) {
  // Lazy state, not a bare call: constructing the client inline would hand
  // QueryClientProvider a brand new cache on every render.
  const [ownClient] = useState(() => client ?? createQueryClient())

  return (
    <ErrorBoundary title="The app failed to start">
      <QueryClientProvider client={client ?? ownClient}>
        <ThemeProvider>
          {children}
          <Toaster
            position="top-right"
            toastOptions={{
              style: {
                background: 'var(--surface)',
                color: 'var(--foreground)',
                border: '1px solid var(--border)',
              },
            }}
          />
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  )
}
