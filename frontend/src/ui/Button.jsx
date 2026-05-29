import { cn } from '@/lib/utils'

const VARIANTS = {
  primary:
    'bg-primary text-primary-foreground hover:bg-primary-strong shadow-sm shadow-primary/30',
  secondary:
    'bg-surface-2 text-foreground hover:bg-surface-2/70 border border-border',
  ghost: 'text-foreground hover:bg-surface-2',
  danger: 'bg-danger text-white hover:opacity-90',
  outline: 'border border-border text-foreground hover:bg-surface-2',
}

const SIZES = {
  sm: 'h-9 px-3 text-sm',
  md: 'h-11 px-5 text-sm',
  lg: 'h-12 px-6 text-base',
  icon: 'h-10 w-10',
}

export default function Button({
  variant = 'primary',
  size = 'md',
  className,
  loading = false,
  disabled,
  children,
  ...props
}) {
  return (
    <button
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.98]',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {loading && (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      )}
      {children}
    </button>
  )
}
