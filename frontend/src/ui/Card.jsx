import { cn } from '@/lib/utils'

export default function Card({ className, children, hover = false, ...props }) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-border bg-surface p-5 shadow-sm',
        hover && 'transition-all hover:-translate-y-0.5 hover:shadow-md',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export function CardHeader({ title, subtitle, icon: Icon, action }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="flex items-center gap-3">
        {Icon && (
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary-soft text-primary">
            <Icon size={20} />
          </span>
        )}
        <div>
          <h3 className="font-semibold text-foreground">{title}</h3>
          {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  )
}
