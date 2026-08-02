import { useState } from 'react'
import toast from 'react-hot-toast'
import {
  Pill,
  Search,
  AlertCircle,
  Repeat2,
  Activity,
  FlaskConical,
  ShieldQuestion,
} from 'lucide-react'
import Card, { CardHeader } from '@/ui/Card'
import Button from '@/ui/Button'
import Badge from '@/ui/Badge'
import { CardSkeleton } from '@/ui/Skeleton'
import EmptyState from '@/ui/EmptyState'
import { getMedicineInfo } from '@/lib/api'
import { errorMessage, titleCase } from '@/lib/utils'

const POPULAR = ['Dolo 650', 'Augmentin 625', 'Azithromycin', 'Pantop 40', 'Telma 40']

function Section({ icon: Icon, title, items, tone = 'neutral' }) {
  if (!items?.length) return null
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
        <Icon size={16} className="text-primary" /> {title}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {items.filter(Boolean).map((it, i) => (
          <Badge key={i} tone={tone}>
            {it}
          </Badge>
        ))}
      </div>
    </div>
  )
}

export default function MedicineSearch() {
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState(null)
  const [notFound, setNotFound] = useState(null)

  const search = async (name = query) => {
    const q = name.trim()
    if (!q) return
    setLoading(true)
    setData(null)
    setNotFound(null)
    try {
      const res = await getMedicineInfo(q)
      if (res.error) setNotFound(res)
      else setData(res)
    } catch (err) {
      toast.error(errorMessage(err, 'Lookup failed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Card>
        <CardHeader
          icon={Pill}
          title="Medicine Intelligence"
          subtitle="Look up uses, side effects, substitutes and drug class"
        />
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="flex flex-1 items-center gap-2 rounded-xl border border-border bg-background px-3">
            <Search size={18} className="text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && search()}
              placeholder="Search a medicine e.g. Dolo 650, Augmentin"
              className="h-11 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted"
            />
          </div>
          <Button onClick={() => search()} loading={loading}>
            Search
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted">Try:</span>
          {POPULAR.map((p) => (
            <button
              key={p}
              onClick={() => {
                setQuery(p)
                search(p)
              }}
              className="rounded-full bg-surface-2 px-3 py-1 text-xs font-medium text-foreground hover:bg-primary-soft hover:text-primary"
            >
              {p}
            </button>
          ))}
        </div>
      </Card>

      {loading && <CardSkeleton />}

      {notFound && (
        <Card className="border-warning/30 bg-warning/5">
          <div className="flex items-start gap-3">
            <AlertCircle size={20} className="mt-0.5 text-warning" />
            <div>
              <h3 className="font-semibold text-foreground">Medicine not found</h3>
              {notFound.suggestions?.length > 0 && (
                <>
                  <p className="mt-1 text-sm text-muted">Did you mean:</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {notFound.suggestions.map((s) => (
                      <button
                        key={s}
                        onClick={() => {
                          setQuery(s)
                          search(s)
                        }}
                        className="rounded-full bg-surface px-3 py-1 text-sm font-medium text-primary hover:bg-primary-soft"
                      >
                        {titleCase(s)}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </Card>
      )}

      {data && (
        <Card className="animate-fade-up">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
            <div className="flex items-center gap-3">
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-primary-soft text-primary">
                <Pill size={24} />
              </span>
              <div>
                <h2 className="text-xl font-bold text-foreground">{titleCase(data.medicine)}</h2>
                {data.habit_forming && (
                  <p className="text-sm text-muted">
                    Habit forming: {data.habit_forming}
                  </p>
                )}
              </div>
            </div>
            {typeof data.match_score === 'number' && (
              <Badge tone="success">{data.match_score.toFixed(0)}% match</Badge>
            )}
          </div>

          <div className="mt-4 space-y-5">
            <Section icon={Activity} title="Uses" items={data.uses} tone="primary" />
            <Section icon={AlertCircle} title="Side effects" items={data.side_effects} tone="danger" />
            <Section icon={Repeat2} title="Substitutes" items={data.substitutes} tone="neutral" />

            <div className="grid gap-3 sm:grid-cols-3">
              {[
                ['Therapeutic class', data.therapeutic_class, Activity],
                ['Chemical class', data.chemical_class, FlaskConical],
                ['Action class', data.action_class, ShieldQuestion],
              ].map(([label, val, Icon]) =>
                val && val !== 'NA' ? (
                  <div key={label} className="rounded-xl bg-surface-2 p-3">
                    <div className="flex items-center gap-1.5 text-xs text-muted">
                      <Icon size={13} /> {label}
                    </div>
                    <p className="mt-1 text-sm font-semibold text-foreground">{val}</p>
                  </div>
                ) : null,
              )}
            </div>

            {data.other_matches?.length > 0 && (
              <div>
                <p className="mb-2 text-sm font-semibold text-foreground">Related results</p>
                <div className="flex flex-wrap gap-2">
                  {data.other_matches.map((m) => (
                    <button
                      key={m.name}
                      onClick={() => {
                        setQuery(m.name)
                        search(m.name)
                      }}
                      className="rounded-full border border-border bg-surface px-3 py-1 text-sm text-foreground hover:bg-surface-2"
                    >
                      {titleCase(m.name)}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Card>
      )}

      {!loading && !data && !notFound && (
        <EmptyState
          icon={Pill}
          title="Search any medicine"
          description="Get clinically useful details — uses, side effects, substitutes and drug classification."
        />
      )}
    </div>
  )
}
