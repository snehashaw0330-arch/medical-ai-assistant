import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { errorMessage } from '@/lib/utils'

/**
 * `useMutation` plus the three things every write in this app did by hand: a
 * success toast, an error toast, and a refetch of whatever the write changed.
 *
 * That last one was the fragile part. Pages re-fetched by calling their own
 * `load()` again, so a write only ever refreshed the page that issued it —
 * registering a model updated the registry list, but a stats card counting
 * models elsewhere kept its old number until a full reload. `invalidates`
 * takes a query key prefix, so `qk.governance.all` refreshes everything under
 * that domain no matter which page is mounted.
 */
export function useApiMutation({
  errorText,
  successText,
  invalidates,
  onSuccess,
  toastErrors = true,
  ...options
}) {
  const queryClient = useQueryClient()

  return useMutation({
    ...options,
    onSuccess: (data, variables, context) => {
      if (successText) toast.success(successText)
      if (invalidates) queryClient.invalidateQueries({ queryKey: invalidates })
      onSuccess?.(data, variables, context)
    },
    onError: (error) => {
      if (toastErrors) toast.error(errorMessage(error, errorText))
    },
  })
}
