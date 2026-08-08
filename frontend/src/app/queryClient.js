import { QueryClient } from '@tanstack/react-query'

/**
 * Server-state defaults for the whole app.
 *
 * Lives apart from `providers.jsx` because a module that exports both a
 * component and a plain function breaks Fast Refresh.
 */
export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Clinical data is read far more often than it changes within a
        // session, and every page currently refetches from scratch on every
        // visit. A minute of staleness removes that without risking a stale
        // reading of anything a user just submitted — mutations invalidate
        // their own keys explicitly.
        staleTime: 60_000,
        gcTime: 5 * 60_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: 0 },
    },
  })
}
