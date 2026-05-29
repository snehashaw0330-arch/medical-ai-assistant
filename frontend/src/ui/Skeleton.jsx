import { cn } from '@/lib/utils'

export default function Skeleton({ className }) {
  return <div className={cn('skeleton rounded-lg', className)} />
}

export function CardSkeleton() {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-xl" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </div>
      <Skeleton className="mt-4 h-3 w-full" />
      <Skeleton className="mt-2 h-3 w-5/6" />
    </div>
  )
}
