import { useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import {
  Stethoscope,
  Plus,
  Search,
  Sparkles,
  AlertTriangle,
  ShieldAlert,
  Info,
  Activity,
  History,
  RotateCcw,
  HelpCircle,
  Lightbulb,
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
import { getFollowups } from '@/lib/followups'
import { useApiQuery } from '@/shared/hooks/useApiQuery'
import { useApiMutation } from '@/shared/hooks/useApiMutation'
import { qk } from '@/shared/hooks/queryKeys'
import { titleCase, formatDate } from '@/lib/utils'

const TOP_K = 5
const RELIABLE_MIN = 60 // below this (top %) the result is not specific enough

// Requirement #8 — confidence bands.
function band(pct) {
  if (pct > 70) return { label: 'High', tone: 'success' }
  if (pct >= 40) return { label: 'Medium', tone: 'warning' }
  return { label: 'Low', tone: 'danger' }
}

// Defensive readers — work with the rich /disease/predict response or a simpler shape.
const readMatched = (r) =>
  r.resolved_symptoms?.filter((x) => x.matched).map((x) => x.matched) ??
  r.matched_symptoms ??
  []
const readUnmatched = (r) => r.unmatched_inputs ?? r.unmatched_symptoms ?? []

export default function DiseasePrediction() {
  const [selected, setSelected] = useState([])
  // Seeded lazily from localStorage: reading it in an effect only to setState
  // costs an extra render and trips the cascading-render rule. This is browser
  // state, not server state, so it stays a `useState` rather than a query.
  const [history, setHistory] = useState(getPredictions)

  // Shared with three other pages under one key, so whichever mounts second
  // serves the vocabulary from cache. This page toasts on failure where the
  // others stay quiet: elsewhere the list is autocomplete garnish, here it is
  // the only way to enter anything.
  const { data: allSymptoms = [] } = useApiQuery({
    queryKey: qk.clinical.symptomOptions(),
    queryFn: getSymptoms,
    errorText: 'Could not load symptom list. Is the API running?',
  })

  const prediction = useApiMutation({
    mutationFn: (symptoms) => predictDisease(symptoms, TOP_K),
    errorText: 'Prediction failed',
    // The symptoms arrive as the mutation's variables rather than off
    // `selected`: a follow-up answer calls `setSelected(next)` and predicts in
    // the same handler, where `selected` is still the previous render's value.
    onSuccess: (data, symptoms) => {
      if (!data.predictions?.length) return
      savePrediction({
        symptoms,
        topDisease: data.predictions[0].disease,
        confidence: data.predictions[0].confidence,
        level: data.confidence_level,
      })
      setHistory(getPredictions())
    },
  })

  const result = prediction.data ?? null
  const loading = prediction.isPending

  const predict = (symptoms = selected) => {
    if (symptoms.length === 0) {
      toast.error('Add at least one symptom')
      return
    }
    prediction.mutate(symptoms)
  }

  const addSymptom = (label) => {
    if (selected.some((s) => s.toLowerCase() === label.toLowerCase())) return
    const next = [...selected, label]
    setSelected(next)
    predict(next)
  }

  const matched = result ? readMatched(result) : []
  const unmatched = result ? readUnmatched(result) : []
  const predictions = result?.predictions ?? []
  // With no ranked predictions the leading warning is the refusal reason, which
  // the empty state presents; the rest still belong in the warnings card.
  const allWarnings = result?.warnings ?? []
  const otherWarnings = predictions.length ? allWarnings : allWarnings.slice(1)

  const topConfidence = predictions.length ? Number(predictions[0].confidence) : 0
  const lowConfidence = predictions.length > 0 && topConfidence < RELIABLE_MIN

  // Requirement #6 — curated follow-ups for ambiguous top condition.
  // Keyed on the disease name rather than the `predictions` array: `?? []` mints
  // a fresh array identity every render, which would invalidate the memo each time.
  const topDisease = predictions.length ? predictions[0].disease : null
  const followups = useMemo(
    () => (topDisease ? getFollowups(topDisease, selected) : []),
    [topDisease, selected],
  )

  return (
    <div className="space-y-5">
      {/* Requirement #1 — persistent educational disclaimer */}
      <div className="flex items-start gap-3 rounded-2xl border border-primary/20 bg-primary-soft/50 px-4 py-3">
        <Info size={18} className="mt-0.5 shrink-0 text-primary" />
        <p className="text-sm text-foreground">
          <span className="font-semibold">Educational use only.</span> These results
          are generated by an AI model trained on a small dataset and are{' '}
          <span className="font-semibold">not medical advice</span>. Always consult a
          qualified healthcare professional.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* ---------------- Input panel ---------------- */}
        <div className="space-y-6 lg:col-span-2">
          <Card className="lg:sticky lg:top-24">
            <CardHeader
              icon={Stethoscope}
              title="Symptom Checker"
              subtitle="Type, paste, or pick symptoms — then check"
            />

            <TagInput
              value={selected}
              onChange={setSelected}
              suggestions={allSymptoms}
              placeholder="e.g. continuous sneezing, chills, runny nose"
              disabled={loading}
            />

            <p className="mt-2 text-xs text-muted">
              Press <kbd className="rounded bg-surface-2 px-1">Enter</kbd> or{' '}
              <kbd className="rounded bg-surface-2 px-1">,</kbd> to add. Unrecognized
              symptoms are validated against our list and shown separately.
            </p>

            <div className="mt-5 flex gap-2">
              <Button
                className="flex-1"
                onClick={() => predict()}
                loading={loading}
                disabled={selected.length === 0}
              >
                <Activity size={16} /> Check Symptoms
              </Button>
              {selected.length > 0 && (
                <Button variant="ghost" onClick={() => setSelected([])} disabled={loading}>
                  Clear
                </Button>
              )}
            </div>
            <p className="mt-3 text-xs text-muted">
              Tip: add 3+ symptoms for a more specific result.
            </p>
          </Card>

          {/* History */}
          {history.length > 0 && (
            <Card>
              <CardHeader icon={History} title="Recent checks" />
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
                      <Badge tone={band(h.confidence || 0).tone}>
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
              description="Add symptoms on the left and run a check to see the top possible conditions, with probabilities and the reasoning behind them."
            />
          )}

          {!loading && result && (
            <>
              {/* Requirement #3 + #10 — low-confidence guidance */}
              {lowConfidence && (
                <Card className="border-warning/40 bg-warning/5">
                  <div className="flex gap-3">
                    <ShieldAlert size={20} className="mt-0.5 shrink-0 text-warning" />
                    <div className="text-sm">
                      <p className="font-semibold text-foreground">
                        Symptoms are not specific enough for a reliable prediction.
                      </p>
                      <p className="mt-1 text-muted">
                        Add more symptoms below to narrow it down, and please consult a
                        healthcare professional for an accurate assessment.
                      </p>
                    </div>
                  </div>
                </Card>
              )}

              {/* Other backend warnings.
                  When nothing was ranked, the first warning IS the refusal
                  reason and is shown by the empty state below — repeating it
                  here would print it twice on the same screen. */}
              {otherWarnings.length > 0 && (
                <Card className="border-warning/30 bg-warning/5">
                  <div className="flex gap-3">
                    <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warning" />
                    <ul className="space-y-1 text-sm text-foreground">
                      {otherWarnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </div>
                </Card>
              )}

              {/* Requirement #2 + #7 — top 5 POSSIBLE CONDITIONS (never "diagnosis") */}
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-foreground">
                  Possible Conditions
                </h2>
                <span className="text-xs text-muted">Ranked by match strength</span>
              </div>

              {/* The model behind these scores is trained on 304 unique rows
                  duplicated 16x, so it scores a perfect top-1 against its own
                  data — a measure of memorisation, not of clinical accuracy.
                  The banner at the top of the page says "small dataset", but it
                  is three cards away from the numbers and does not say what is
                  wrong with *them*: a bare "97.3% / High" reads as a calibrated
                  probability. Qualify it here, next to the ranked list, and once
                  rather than on each of five cards. */}
              {predictions.length > 0 && (
                <div className="flex items-start gap-2 rounded-xl border border-border bg-surface-2 px-3 py-2">
                  <Info size={14} className="mt-0.5 shrink-0 text-muted" />
                  <p className="text-xs text-muted">
                    <span className="font-semibold text-foreground">
                      Demo dataset.
                    </span>{' '}
                    These percentages describe how closely your symptoms matched
                    patterns in a small teaching dataset. They are{' '}
                    <span className="font-semibold">not calibrated probabilities</span>{' '}
                    and say nothing about how often the condition is the right
                    answer in real patients.
                  </p>
                </div>
              )}

              {predictions.length === 0 ? (
                // The backend refuses to rank below its floors and says exactly
                // why ("A single symptom cannot distinguish between 41
                // conditions"). Showing generic advice here overrode that with
                // the wrong instruction — rephrasing does not help when what is
                // needed is another symptom — and "no conditions matched"
                // implies the model looked and found nothing, when in fact it
                // declined to look.
                <EmptyState
                  icon={Search}
                  title="No assessment produced"
                  description={
                    result.warnings?.[0] ??
                    'Try rephrasing or adding more specific symptoms.'
                  }
                />
              ) : (
                predictions.map((p, i) => {
                  const conf = Number(p.confidence)
                  const b = band(conf)
                  return (
                    <Card key={p.disease} hover className="animate-fade-up">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary-soft text-sm font-bold text-primary">
                            #{i + 1}
                          </span>
                          <div>
                            <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
                              Possible Condition
                            </p>
                            <h3 className="text-lg font-semibold leading-tight text-foreground">
                              {p.disease}
                            </h3>
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <span className="text-sm font-bold text-foreground">
                            {conf.toFixed(1)}%
                          </span>
                          <Badge tone={b.tone}>{b.label}</Badge>
                        </div>
                      </div>

                      <div className="mt-4">
                        <ConfidenceBar value={conf} showLabel={false} />
                      </div>

                      {/* Requirement #9 — Why this prediction? */}
                      <div className="mt-4 rounded-xl bg-surface-2 p-3">
                        <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                          <HelpCircle size={14} className="text-primary" /> Why this prediction?
                        </p>
                        <p className="mt-1 text-sm text-muted">
                          {p.explanation ||
                            'Based on the combination of symptoms you reported.'}
                        </p>
                        {p.matched_symptoms?.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {p.matched_symptoms.map((s) => (
                              <Badge key={s} tone="success">
                                {titleCase(s)}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    </Card>
                  )
                })
              )}

              {/* Requirement #6 — follow-up questions for ambiguous conditions */}
              {followups.length > 0 && (
                <Card className="border-primary/20 bg-primary-soft/40">
                  <CardHeader
                    icon={Lightbulb}
                    title="A few quick questions"
                    subtitle={`These help tell ${predictions[0].disease} apart from similar conditions.`}
                  />
                  <ul className="space-y-2">
                    {followups.map((f) => (
                      <li
                        key={f.symptom}
                        className="flex items-center justify-between gap-3 rounded-xl bg-surface p-3"
                      >
                        <span className="text-sm text-foreground">{f.q}</span>
                        <Button size="sm" variant="secondary" onClick={() => addSymptom(f.symptom)}>
                          <Plus size={14} /> Yes
                        </Button>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}

              {/* Generic suggested symptoms (when no curated follow-ups apply) */}
              {followups.length === 0 && result.suggested_symptoms?.length > 0 && (
                <Card className="border-primary/20 bg-primary-soft/40">
                  <CardHeader
                    icon={Sparkles}
                    title="Add more detail"
                    subtitle="Do you also have any of these? Tap to refine the result."
                  />
                  <div className="flex flex-wrap gap-2">
                    {result.suggested_symptoms.map((s) => (
                      <button
                        key={s.symptom}
                        onClick={() => addSymptom(s.symptom)}
                        className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-surface px-3 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
                      >
                        <Plus size={13} /> {titleCase(s.symptom)}
                      </button>
                    ))}
                  </div>
                </Card>
              )}

              {/* Requirement #4 + #5 — symptom validation: matched vs unmatched */}
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
                    <>
                      <div className="flex flex-wrap gap-1.5">
                        {unmatched.map((u) => (
                          <Badge key={u} tone="danger">
                            {u}
                          </Badge>
                        ))}
                      </div>
                      <p className="mt-2 text-xs text-muted">
                        These weren’t found in our symptom list and were ignored.
                      </p>
                    </>
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
    </div>
  )
}
