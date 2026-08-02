import { Component } from 'react'
import { TriangleAlert, RotateCcw } from 'lucide-react'
import Button from '@/ui/Button'

/**
 * Error boundaries have to be class components — React exposes no hook
 * equivalent of componentDidCatch.
 *
 * Used at two levels: once around the whole app, and once per route inside the
 * layout. The per-route one is what matters day to day — before it, a single
 * page throwing during render took the entire app to a white screen, sidebar
 * included, with no way back.
 */
export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[MediSense] render error', error, info)
  }

  reset = () => this.setState({ error: null })

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div
        role="alert"
        className="flex min-h-[50vh] flex-col items-center justify-center px-4 text-center"
      >
        <span className="grid h-16 w-16 place-items-center rounded-3xl bg-danger/10 text-danger">
          <TriangleAlert size={30} />
        </span>
        <h2 className="mt-5 text-xl font-semibold text-foreground">
          {this.props.title ?? 'This view failed to load'}
        </h2>
        <p className="mt-2 max-w-md text-sm text-muted">
          The rest of the app is unaffected — you can retry, or use the sidebar
          to go somewhere else.
        </p>
        <pre className="mt-4 max-w-lg overflow-x-auto rounded-xl border border-border bg-surface-2 p-3 text-left text-xs text-muted">
          {String(error?.message ?? error)}
        </pre>
        <Button className="mt-5" onClick={this.reset}>
          <RotateCcw size={15} /> Try again
        </Button>
      </div>
    )
  }
}
