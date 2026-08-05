import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { errorMessage } from '@/lib/utils'

/**
 * `useQuery` plus the one behaviour every page here already had: a toast when
 * the fetch fails.
 *
 * Pages used to hand-roll the whole thing — a `loading` flag, a `try/catch`, an
 * `alive` guard against setting state after unmount, and a toast — roughly ten
 * lines each across 23 pages. Only the toast is worth keeping, and keeping it
 * here means it cannot be forgotten on the next page.
 *
 * `errorText` is the fallback message; the server's own message wins when it
 * sends one, exactly as `errorMessage` already did.
 */
export function useApiQuery({ errorText, ...options }) {
  const query = useQuery(options)
  const { error } = query

  useEffect(() => {
    if (error) toast.error(errorMessage(error, errorText))
  }, [error, errorText])

  return query
}
