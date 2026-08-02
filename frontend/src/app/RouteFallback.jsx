import { CardSkeleton } from '@/ui/Skeleton'

/**
 * Shown while a lazily-loaded route chunk is in flight.
 *
 * The testid is load-bearing: the route tests wait for this to disappear before
 * asserting on a page, so code-splitting cannot make a broken page look healthy
 * by never having rendered it.
 */
export default function RouteFallback() {
  return (
    <div data-testid="route-loading" className="space-y-4" aria-busy="true">
      <span className="sr-only">Loading…</span>
      <CardSkeleton />
      <CardSkeleton />
    </div>
  )
}
