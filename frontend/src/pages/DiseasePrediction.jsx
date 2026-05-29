import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import {
  Stethoscope,
  Plus,
  Search,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  Activity,
  History,
  RotateCcw,
} from 'lucide-react'
import Card, { CardHeader } from '@/ui/Card'
import Button from '@/ui/Button'
import Badge from '@/ui/Badge'
import ConfidenceBar from '@/ui/ConfidenceBar'
import TagInput from '@/ui/TagInput'
import { CardSkeleton } from '@/ui/Skeleton'
import EmptyState from '@/ui/EmptyState'
import { getSymptoms, predictDisease } from '@/lib/api'
import { savePrediction, getPredictions } from '@/lib/storage'
import { errorMessage, titleCase, formatDate } from '@/lib/utils'

const LEVEL_TONE = { high: 'success', moderate: 'warning', low: 'danger' }

// Defensive readers — work with both the rich (/disease/predict) response and a
// simpler {matched_symptoms, unmatched_symptoms} shape.
const readMatched = (r) =>
  r.resolved_symptoms?.filter((x) => x.matched).map((x) => x.matched) ??
  r.matched_symptoms ??
  []
const readUnmatched = (r) => r.unmatched_inputs ?? r.unmatched_symptoms ?? []

export default function DiseasePrediction() {
  const [allSymptoms, setAllSymptoms] = useState([])
  const [selected, setSelected] = useState([])
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [history, setHistory] = useState([])

  useEffect(() => {
    getSymptoms()
      .then(setAllSymptoms)
      .catch(() =>
        toast.error('Could not load symptom list. Is the API running?'),
      )
    setHistory(getPredictions())
  }, [])

  const predict = async (symptoms = selected) => {
    if (symptoms.length === 0) {
      toast.error('Add at least one symptom')
      return
    }
    setLoading(true)
    try {
      const data = await predictDisease(symptoms, 3)
      setResult(data)
      if (data.predictions?.length) {
        savePrediction({
          symptoms,
          topDisease: data.predictions[0].disease,
          confidence: data.predictions[0].confidence,
          level: data.confidence_level,
        })
        setHistory(getPredictions())
      }
    } catch (err) {
      toast.error(errorMessage(err, 'Prediction failed'))
    } finally {
      setLoading(false)
    }
  }

  const addSuggested = (label) => {
    const next = [...selected, label]
    setSelected(next)
    predict(next)
  }

  const matched = result ? readMatched(result) : []
  const unmatched = result ? readUnmatched(result) : []

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      {/* ---------------- Input panel ---------------- */}
      <div className="space-y-6 lg:col-span-2">
        <Card className="lg:sticky lg:top-24">
          <CardHeader
            icon={Stethoscope}
            title="Symptom Checker"
            subtitle="Type, paste, or pick symptoms — then predict"
          />

          <label htmlFor="symptom-input" className="sr-only">
            Symptoms
          </label>
          <TagInput
            value={selected}
            onChange={setSelected}
            suggestions={allSymptoms}
            placeholder="e.g. continuous sneezing, chills, runny nose"
            disabled={loading}
          />

          <p className="mt-2 text-xs text-muted">
            Press <kbd className="rounded bg-surface-2 px-1">Enter</kbd> or{' '}
            <kbd className="rounded bg-surface-2 px-1">,</kbd> to add. You can
            paste a comma-separated list.
          </p>

          <div className="mt-5 flex gap-2">
            <Button
              className="flex-1"
              onClick={() => predict()}
              loading={loading}
              disabled={selected.length === 0}
            >
              <Activity size={16} /> Predict
            </Button>
            {selected.length > 0 && (
              <Button variant="ghost" onClick={() => setSelected([])} disabled={loading}>
                Clear
              </Button>
            )}
          </div>
          <p className="mt-3 text-xs text-muted">
            Tip: add 3+ symptoms for a more confident assessment.
          </p>
        </Card>

        {/* History */}
        {history.length > 0 && (
          <Card>
            <CardHeader icon={History} title="Recent predictions" />
            <ul className="space-y-2">
              {history.slice(0, 5).map((h) => (
                <li
                  key={h.id}
                  className="flex items-center justify-between gap-2 rounded-xl bg-surface-2 p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {h.topDisease}
                    </p>
                    <p className="text-xs text-muted">{formatDate(h.at)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={LEVEL_TONE[h.level] || 'neutral'}>
                      {h.confidence?.toFixed?.(0)}%
                    </Badge>
                    <button
                      aria-label="Reuse these symptoms"
                      title="Reuse these symptoms"
                      onClick={() => {
                        setSelected(h.symptoms || [])
                        predict(h.symptoms || [])
                      }}
                      className="grid h-7 w-7 place-items-center rounded-lg text-muted hover:bg-surface hover:text-primary"
                    >
                      <RotateCcw size={14} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      {/* ---------------- Results panel ---------------- */}
      <div className="space-y-4 lg:col-span-3">
        {loading && (
          <>
            <CardSkeleton />
            <CardSkeleton />
          </>
        )}

        {!loading && !result && (
          <EmptyState
            icon={Stethoscope}
            title="Your results will appear here"
            description="Add symptoms on the left and run a prediction to see the top likely conditions, with confidence and explanations."
          />
        )}

        {!loading && result && (
          <>
            {/* Summary */}
            {result.confidence_level && (
              <div className="flex flex-wrap items-center gap-3">
                <Badge tone={LEVEL_TONE[result.confidence_level] || 'neutral'}>
                  {result.confidence_level === 'high' ? (
                    <CheckCircle2 size={12} />
                  ) : (
                    <AlertTriangle size={12} />
                  )}
                  {titleCase(result.confidence_level)} confidence
                </Badge>
                {result.resolved_symptoms?.some(
                  (r) => r.method === 'fuzzy' || r.method === 'alias',
                ) && (
                  <span className="text-xs text-muted">
                    Some inputs were auto-corrected to known symptoms
                  </span>
                )}
              </div>
            )}

            {/* Warnings */}
            {result.warnings?.length > 0 && (
              <Card className="border-warning/30 bg-warning/5">
                <div className="flex gap-3">
                  <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warning" />
                  <ul className="space-y-1 text-sm text-foreground">
                    {result.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              </Card>
            )}

            {/* Predictions (top 3) */}
            {result.predictions?.length === 0 ? (
              <EmptyState
                icon={Search}
                title="No conditions matched"
                description="Try rephrasing or adding more specific symptoms."
              />
            ) : (
              result.predictions.map((p, i) => (
                <Card key={p.disease} hover className="animate-fade-up">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary-soft text-sm font-bold text-primary">
                        #{i + 1}
                      </span>
                      <h3 className="text-lg font-semibold text-foreground">{p.disease}</h3>
                    </div>
                    <Badge tone={i === 0 ? 'primary' : 'neutral'}>
                      {Number(p.confidence).toFixed(1)}%
                    </Badge>
                  </div>
                  <div className="mt-4">
                    <ConfidenceBar value={Number(p.confidence)} showLabel={false} />
                  </div>
                  {p.explanation && (
                    <p className="mt-3 text-sm text-muted">{p.explanation}</p>
                  )}
                  {p.matched_symptoms?.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {p.matched_symptoms.map((s) => (
                        <Badge key={s} tone="success">
                          {titleCase(s)}
                        </Badge>
                      ))}
                    </div>
                  )}
                </Card>
              ))
            )}

            {/* Suggested follow-up symptoms */}
            {result.suggested_symptoms?.length > 0 && (
              <Card className="border-primary/20 bg-primary-soft/40">
                <CardHeader
                  icon={Sparkles}
                  title="Improve this diagnosis"
                  subtitle="Do you also have any of these? Tap to refine."
                />
                <div className="flex flex-wrap gap-2">
                  {result.suggested_symptoms.map((s) => (
                    <button
                      key={s.symptom}
                      onClick={() => addSuggested(s.symptom)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-surface px-3 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
                    >
                      <Plus size={13} /> {titleCase(s.symptom)}
                    </button>
                  ))}
                </div>
              </Card>
            )}

            {/* Matched + unmatched */}
            <div className="grid gap-4 sm:grid-cols-2">
              <Card>
                <h4 className="mb-2 text-sm font-semibold text-foreground">
                  Matched symptoms
                </h4>
                {matched.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {matched.map((m) => (
                      <Badge key={m} tone="success">
                        {titleCase(m)}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted">None recognized.</p>
                )}
              </Card>
              <Card>
                <h4 className="mb-2 text-sm font-semibold text-foreground">
                  Unmatched symptoms
                </h4>
                {unmatched.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {unmatched.map((u) => (
                      <Badge key={u} tone="danger">
                        {u}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted">All inputs were recognized.</p>
                )}
              </Card>
            </div>

            {result.disclaimer && (
              <p className="text-center text-xs text-muted">{result.disclaimer}</p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
