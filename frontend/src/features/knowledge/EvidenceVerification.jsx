import { useRef, useState } from 'react'
import toast from 'react-hot-toast'
import {
  ShieldCheck,
  Sparkles,
  RotateCcw,
  History as HistoryIcon,
  ChevronRight,
} from 'lucide-react'
import Card, { CardHeader } from '@/ui/Card'
import Button from '@/ui/Button'
import Badge from '@/ui/Badge'
import EmptyState from '@/ui/EmptyState'
import EvidenceVerificationPanel from '@/shared/reports/EvidenceVerificationPanel'
import { checkVerification, getVerificationHistory, getVerificationReport } from '@/lib/api'
import { useApiQuery } from '@/shared/hooks/useApiQuery'
import { useApiMutation } from '@/shared/hooks/useApiMutation'
import { qk } from '@/shared/hooks/queryKeys'
import { formatDate } from '@/lib/utils'

const RISK_TONE = { very_low: 'success', low: 'success', medium: 'warning', high: 'danger', critical: 'danger' }

const inputCls =
  'w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary'

export default function EvidenceVerification() {
  const [question, setQuestion] = useState('')
  const [response, setResponse] = useState('')
  const [generate, setGenerate] = useState(true)
  const resultRef = useRef(null)

  const scrollToResult = () =>
    setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)

  const { data: historyPage } = useApiQuery({
    queryKey: qk.evidence.verifications(),
    queryFn: () => getVerificationHistory({ page_size: 8 }),
    errorText: 'Could not load past verifications',
  })
  const history = historyPage?.items ?? []

  const verify = useApiMutation({
    mutationFn: () =>
      checkVerification({
        question: question.trim(),
        response: response.trim() || null,
        generate_if_missing: generate,
        source_module: 'manual',
        use_cache: true,
        persist: true,
      }),
    errorText: 'Verification failed. Is the backend running?',
    // Every verification is persisted, so the history list below is stale.
    invalidates: qk.evidence.verifications(),
    onSuccess: (data) => {
      if (data.generated && !response.trim()) setResponse(data.response)
      scrollToResult()
    },
  })

  // Opening a past verification is a mutation rather than a query because its
  // whole point is to *write into the form* — question and response boxes — as
  // a one-time consequence of the click. As a query that would need an effect
  // syncing state to fetched data, which is the pattern this phase removes.
  const open = useApiMutation({
    mutationFn: (id) => getVerificationReport(id),
    errorText: 'Could not load that verification.',
    onSuccess: (data) => {
      setQuestion(data.question || '')
      setResponse(data.response || '')
      verify.reset()
      scrollToResult()
    },
  })

  // A fresh verification wins over one opened from history; opening clears the
  // verification so the reverse also holds. Only one reset is needed for that —
  // the other direction is already decided here.
  const result = verify.data ?? open.data ?? null
  const loading = verify.isPending || open.isPending

  const run = () => {
    if (!question.trim()) {
      toast.error('Enter a question first.')
      return
    }
    if (!response.trim() && !generate) {
      toast.error('Provide a response to verify, or enable "generate from knowledge base".')
      return
    }
    verify.mutate()
  }

  const openHistory = (id) => open.mutate(id)

  const reset = () => {
    setQuestion('')
    setResponse('')
    verify.reset()
    open.reset()
  }

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      {/* ---- Input panel ---- */}
      <div className="lg:col-span-2">
        <Card className="lg:sticky lg:top-24">
          <CardHeader
            icon={ShieldCheck}
            title="Evidence Verification"
            subtitle="Check whether an AI answer is grounded in the medical knowledge base"
          />

          <div className="space-y-4">
            <label className="block">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted">Question</span>
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                rows={2}
                placeholder="e.g. What is metformin used for and its main risks?"
                className={`mt-1 ${inputCls}`}
              />
            </label>

            <label className="block">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted">
                AI response to verify {generate && '(optional — will be generated)'}
              </span>
              <textarea
                value={response}
                onChange={(e) => setResponse(e.target.value)}
                rows={5}
                placeholder="Paste an AI-generated answer to verify, or leave blank to generate one from the knowledge base."
                className={`mt-1 ${inputCls}`}
              />
            </label>

            <label className="flex items-center gap-2 text-sm text-foreground">
              <input type="checkbox" checked={generate} onChange={(e) => setGenerate(e.target.checked)} />
              Generate the answer from the knowledge base if left blank
            </label>

            <div className="flex gap-2">
              <Button className="flex-1" onClick={run} loading={loading}>
                <Sparkles size={16} /> Verify
              </Button>
              <Button variant="secondary" onClick={reset} aria-label="Reset"><RotateCcw size={16} /></Button>
            </div>
            <p className="text-xs text-muted">
              Every claim in the response is checked against retrieved evidence. Unsupported claims are
              highlighted in red. This is an automated safeguard, not a guarantee of correctness.
            </p>
          </div>

          {history.length > 0 && (
            <div className="mt-6 border-t border-border pt-4">
              <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                <HistoryIcon size={15} className="text-primary" /> Recent verifications
              </p>
              <div className="space-y-2">
                {history.map((h) => (
                  <button
                    key={h.id}
                    onClick={() => openHistory(h.id)}
                    className="flex w-full items-center gap-3 rounded-xl border border-border bg-surface p-3 text-left transition-colors hover:bg-surface-2"
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-primary">
                      <ShieldCheck size={16} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{h.question || 'Verification'}</p>
                      <p className="truncate text-xs text-muted">{formatDate(h.created_at)} · {Math.round(h.confidence)}% conf</p>
                    </div>
                    <Badge tone={RISK_TONE[h.hallucination_risk] || 'neutral'}>{Math.round(h.evidence_coverage)}%</Badge>
                    <ChevronRight size={16} className="shrink-0 text-muted" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* ---- Result panel ---- */}
      <div ref={resultRef} className="lg:col-span-3">
        {result ? (
          <EvidenceVerificationPanel result={result} />
        ) : (
          <EmptyState
            icon={ShieldCheck}
            title="Verification results will appear here"
            description="Enter a medical question and (optionally) an AI-generated answer. The engine retrieves supporting evidence, checks every claim, and reports evidence coverage, citation strength, a hallucination-risk badge and any unsupported statements."
          />
        )}
      </div>
    </div>
  )
}
