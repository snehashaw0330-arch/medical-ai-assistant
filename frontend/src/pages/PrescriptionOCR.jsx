import { useRef, useState } from 'react'
import toast from 'react-hot-toast'
import {
  ScanLine,
  UploadCloud,
  Camera,
  X,
  FileDown,
  Pill,
  AlertTriangle,
  StickyNote,
  Loader2,
  ShieldAlert,
} from 'lucide-react'
import Card, { CardHeader } from '@/ui/Card'
import Button from '@/ui/Button'
import Badge from '@/ui/Badge'
import ConfidenceBar from '@/ui/ConfidenceBar'
import EmptyState from '@/ui/EmptyState'
import { extractPrescription } from '@/lib/api'
import { saveReport } from '@/lib/storage'
import { errorMessage, titleCase } from '@/lib/utils'

function buildReport(result, fileName) {
  const lines = [
    'MEDISENSE — PRESCRIPTION OCR REPORT',
    `Generated: ${new Date().toLocaleString()}`,
    `Source image: ${fileName}`,
    `OCR engine: ${result.provider}`,
    `Overall confidence: ${(result.overall_confidence * 100).toFixed(1)}%`,
    '',
    'MEDICINES',
    '─────────',
  ]
  result.medicines.forEach((m, i) => {
    lines.push(
      `${i + 1}. ${m.name || m.raw_text}  ${m.needs_review ? '[NEEDS REVIEW]' : ''}`,
      `   dosage: ${m.dosage || '-'} | frequency: ${m.frequency_expanded || m.frequency || '-'} | duration: ${m.duration || '-'}`,
      `   confidence: ${(m.confidence * 100).toFixed(0)}%`,
    )
  })
  if (result.doctor_notes?.length) {
    lines.push('', 'DOCTOR NOTES', '────────────', ...result.doctor_notes.map((n) => `• ${n}`))
  }
  lines.push('', 'This is an AI-assisted transcription. Verify against the original prescription.')
  return lines.join('\n')
}

function MedicineCard({ med }) {
  const pct = Math.round((med.confidence || 0) * 100)
  const d = med.details
  return (
    <Card hover className="animate-fade-up">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary-soft text-primary">
            <Pill size={20} />
          </span>
          <div>
            <h3 className="font-semibold text-foreground">
              {med.name ? titleCase(med.name) : med.raw_text}
            </h3>
            <p className="text-xs text-muted">Read as: “{med.raw_text}”</p>
          </div>
        </div>
        {med.needs_review ? (
          <Badge tone="danger">
            <ShieldAlert size={12} /> Verify
          </Badge>
        ) : (
          <Badge tone="success">{pct}%</Badge>
        )}
      </div>

      <div className="mt-3">
        <ConfidenceBar value={pct} showLabel={false} />
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        {[
          ['Dosage', med.dosage],
          ['Frequency', med.frequency_expanded || med.frequency],
          ['Duration', med.duration],
        ].map(([label, val]) => (
          <div key={label} className="rounded-xl bg-surface-2 p-2.5">
            <p className="text-[11px] uppercase tracking-wide text-muted">{label}</p>
            <p className="mt-0.5 text-sm font-semibold text-foreground">{val || '—'}</p>
          </div>
        ))}
      </div>

      {med.candidates?.length > 1 && (
        <div className="mt-3">
          <p className="text-xs font-medium text-muted">Other possible matches</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {med.candidates.slice(1).map((c) => (
              <Badge key={c.name} tone="neutral">
                {titleCase(c.name)} · {c.score.toFixed(0)}%
              </Badge>
            ))}
          </div>
        </div>
      )}

      {d && (d.therapeutic_class || d.uses?.length || d.side_effects?.length) && (
        <div className="mt-4 space-y-3 border-t border-border pt-4 text-sm">
          {d.therapeutic_class && (
            <div className="flex flex-wrap gap-1.5">
              <Badge tone="primary">{d.therapeutic_class}</Badge>
              {d.action_class && d.action_class !== 'NA' && (
                <Badge tone="neutral">{d.action_class}</Badge>
              )}
            </div>
          )}
          {d.uses?.length > 0 && (
            <div>
              <p className="font-medium text-foreground">Uses</p>
              <p className="text-muted">{d.uses.join(', ')}</p>
            </div>
          )}
          {d.side_effects?.length > 0 && (
            <div>
              <p className="font-medium text-foreground">Side effects</p>
              <p className="text-muted">{d.side_effects.slice(0, 6).join(', ')}</p>
            </div>
          )}
          {d.substitutes?.length > 0 && (
            <div>
              <p className="font-medium text-foreground">Substitutes</p>
              <p className="text-muted">{d.substitutes.slice(0, 4).join(', ')}</p>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

export default function PrescriptionOCR() {
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [progress, setProgress] = useState(0)
  const [processing, setProcessing] = useState(false)
  const [result, setResult] = useState(null)
  const inputRef = useRef(null)
  const cameraRef = useRef(null)

  const pickFile = (f) => {
    if (!f) return
    if (!f.type.startsWith('image/')) {
      toast.error('Please choose an image file')
      return
    }
    setFile(f)
    setPreview(URL.createObjectURL(f))
    setResult(null)
  }

  const onDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    pickFile(e.dataTransfer.files?.[0])
  }

  const reset = () => {
    setFile(null)
    setPreview(null)
    setResult(null)
    setProgress(0)
  }

  const run = async () => {
    if (!file) return
    setProcessing(true)
    setProgress(0)
    try {
      const data = await extractPrescription(file, {
        onProgress: setProgress,
      })
      setResult(data)
      saveReport({
        fileName: file.name,
        provider: data.provider,
        medicineCount: data.medicines?.length || 0,
        overall: data.overall_confidence,
      })
      toast.success(`Extracted ${data.medicines?.length || 0} medicine(s)`)
    } catch (err) {
      toast.error(errorMessage(err, 'OCR failed — check the API/provider key'))
    } finally {
      setProcessing(false)
    }
  }

  const download = () => {
    const blob = new Blob([buildReport(result, file?.name || 'prescription')], {
      type: 'text/plain',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'medisense-report.txt'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      {/* Upload panel */}
      <div className="lg:col-span-2">
        <Card className="lg:sticky lg:top-24">
          <CardHeader
            icon={ScanLine}
            title="Upload Prescription"
            subtitle="Handwritten or printed — we’ll read it"
          />

          {!preview ? (
            <div
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => inputRef.current?.click()}
              className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-10 text-center transition-colors ${
                dragOver
                  ? 'border-primary bg-primary-soft'
                  : 'border-border hover:border-primary/50 hover:bg-surface-2'
              }`}
            >
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-primary-soft text-primary">
                <UploadCloud size={26} />
              </span>
              <p className="mt-3 font-medium text-foreground">
                Drag & drop, or click to browse
              </p>
              <p className="mt-1 text-xs text-muted">PNG, JPG, WEBP up to ~10MB</p>
            </div>
          ) : (
            <div className="relative overflow-hidden rounded-2xl border border-border">
              <img src={preview} alt="preview" className="max-h-72 w-full object-contain bg-surface-2" />
              <button
                onClick={reset}
                className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-black/60 text-white hover:bg-black/80"
              >
                <X size={16} />
              </button>
              {processing && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/80 backdrop-blur-sm">
                  <Loader2 size={32} className="animate-spin text-primary" />
                  <p className="text-sm font-medium text-foreground">
                    {progress < 100 ? `Uploading ${progress}%` : 'Reading handwriting…'}
                  </p>
                  <div className="h-1.5 w-40 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${progress || 10}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => pickFile(e.target.files?.[0])}
          />
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => pickFile(e.target.files?.[0])}
          />

          <div className="mt-4 flex gap-2">
            <Button className="flex-1" onClick={run} loading={processing} disabled={!file}>
              <ScanLine size={16} /> Extract
            </Button>
            <Button variant="secondary" onClick={() => cameraRef.current?.click()}>
              <Camera size={16} />
            </Button>
          </div>
          <p className="mt-3 text-xs text-muted">
            Best results: good lighting, flat page, whole prescription in frame.
          </p>
        </Card>
      </div>

      {/* Results */}
      <div className="space-y-4 lg:col-span-3">
        {!result && !processing && (
          <EmptyState
            icon={Pill}
            title="Extracted medicines will appear here"
            description="Upload a prescription image and hit Extract to read medicines, dosage, frequency and clinical details."
          />
        )}

        {result && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Badge tone="primary">
                  {result.provider === 'local'
                    ? 'Using local OCR engine'
                    : `Engine: ${titleCase(result.provider)}`}
                </Badge>
                <Badge tone="success">
                  Overall {(result.overall_confidence * 100).toFixed(0)}%
                </Badge>
              </div>
              <Button variant="secondary" size="sm" onClick={download}>
                <FileDown size={15} /> Download report
              </Button>
            </div>

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

            {result.medicines?.length === 0 ? (
              <EmptyState
                icon={ScanLine}
                title="No medicines detected"
                description="Try a clearer, well-lit photo of the full prescription."
              />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {result.medicines.map((m, i) => (
                  <MedicineCard key={i} med={m} />
                ))}
              </div>
            )}

            {result.doctor_notes?.length > 0 && (
              <Card>
                <CardHeader icon={StickyNote} title="Doctor notes" />
                <ul className="space-y-1.5 text-sm text-foreground">
                  {result.doctor_notes.map((n, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-primary">•</span>
                      {n}
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {result.raw_text && (
              <details className="rounded-2xl border border-border bg-surface p-4">
                <summary className="cursor-pointer text-sm font-medium text-foreground">
                  View raw OCR text
                </summary>
                <pre className="mt-3 whitespace-pre-wrap text-xs text-muted">
                  {result.raw_text}
                </pre>
              </details>
            )}
          </>
        )}
      </div>
    </div>
  )
}
