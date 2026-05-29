import { confidenceColor } from '@/lib/utils'

/** Animated horizontal confidence meter (0..100). */
export default function ConfidenceBar({ value = 0, showLabel = true }) {
  const pct = Math.max(0, Math.min(100, value))
  const color = confidenceColor(pct)
  return (
    <div className="w-full">
      {showLabel && (
        <div className="mb-1 flex justify-between text-xs font-medium text-muted">
          <span>Confidence</span>
          <span style={{ color }}>{pct.toFixed(1)}%</span>
        </div>
      )}
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full transition-[width] duration-700 ease-out"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  )
}
