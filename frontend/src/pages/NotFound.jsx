import { Link } from 'react-router-dom'
import { Compass } from 'lucide-react'
import Button from '@/ui/Button'

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <span className="grid h-20 w-20 place-items-center rounded-3xl bg-primary-soft text-primary">
        <Compass size={36} />
      </span>
      <h1 className="mt-6 text-5xl font-bold text-foreground">404</h1>
      <p className="mt-2 max-w-sm text-muted">
        This page wandered off. Let’s get you back to your clinical workspace.
      </p>
      <Link to="/" className="mt-6">
        <Button>Back to Dashboard</Button>
      </Link>
    </div>
  )
}
