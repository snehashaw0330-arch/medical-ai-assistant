import { useState } from 'react'
import toast from 'react-hot-toast'
import {
  User,
  Mail,
  BriefcaseMedical,
  Save,
  Stethoscope,
  ScanLine,
  Trash2,
  History,
} from 'lucide-react'
import Card, { CardHeader } from '@/ui/Card'
import Button from '@/ui/Button'
import Badge from '@/ui/Badge'
import EmptyState from '@/ui/EmptyState'
import {
  getProfile,
  setProfile,
  getPredictions,
  getReports,
  clearHistory,
} from '@/lib/storage'
import { formatDate, titleCase } from '@/lib/utils'

const LEVEL_TONE = { high: 'success', moderate: 'warning', low: 'danger' }

export default function Profile() {
  const [profile, setProfileState] = useState(getProfile())
  const [predictions, setPredictions] = useState(getPredictions())
  const [reports, setReports] = useState(getReports())

  const saveProfile = () => {
    setProfile(profile)
    toast.success('Profile saved')
  }

  const wipe = () => {
    clearHistory()
    setPredictions([])
    setReports([])
    toast.success('History cleared')
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Profile card */}
        <Card className="lg:col-span-1">
          <div className="flex flex-col items-center text-center">
            <span className="grid h-20 w-20 place-items-center rounded-3xl bg-gradient-to-br from-primary to-accent text-2xl font-bold text-white">
              {profile.name?.[0] || 'U'}
            </span>
            <h2 className="mt-3 text-lg font-bold text-foreground">{profile.name}</h2>
            <p className="text-sm text-muted">{profile.role}</p>
            <div className="mt-4 flex w-full justify-around rounded-2xl bg-surface-2 p-3">
              <div>
                <p className="text-xl font-bold text-foreground">{predictions.length}</p>
                <p className="text-xs text-muted">Diagnoses</p>
              </div>
              <div className="border-x border-border px-5">
                <p className="text-xl font-bold text-foreground">{reports.length}</p>
                <p className="text-xs text-muted">Scans</p>
              </div>
              <div>
                <p className="text-xl font-bold text-foreground">
                  {reports.reduce((a, r) => a + (r.medicineCount || 0), 0)}
                </p>
                <p className="text-xs text-muted">Meds</p>
              </div>
            </div>
          </div>
        </Card>

        {/* Edit form */}
        <Card className="lg:col-span-2">
          <CardHeader icon={User} title="Account details" subtitle="Update your profile information" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field icon={User} label="Full name" value={profile.name}
              onChange={(v) => setProfileState({ ...profile, name: v })} />
            <Field icon={BriefcaseMedical} label="Role" value={profile.role}
              onChange={(v) => setProfileState({ ...profile, role: v })} />
            <div className="sm:col-span-2">
              <Field icon={Mail} label="Email" value={profile.email}
                onChange={(v) => setProfileState({ ...profile, email: v })} />
            </div>
          </div>
          <div className="mt-5">
            <Button onClick={saveProfile}>
              <Save size={16} /> Save changes
            </Button>
          </div>
        </Card>
      </div>

      {/* History */}
      <Card>
        <CardHeader
          icon={History}
          title="Activity history"
          subtitle="Stored locally on this device"
          action={
            (predictions.length > 0 || reports.length > 0) && (
              <Button variant="ghost" size="sm" onClick={wipe}>
                <Trash2 size={15} /> Clear
              </Button>
            )
          }
        />

        {predictions.length === 0 && reports.length === 0 ? (
          <EmptyState
            icon={History}
            title="No history yet"
            description="Your diagnoses and prescription scans will be listed here."
          />
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                <Stethoscope size={16} className="text-primary" /> Recent diagnoses
              </h4>
              <div className="space-y-2">
                {predictions.length === 0 && <p className="text-sm text-muted">None yet.</p>}
                {predictions.map((p) => (
                  <div key={p.id} className="flex items-center justify-between rounded-xl bg-surface-2 p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{p.topDisease}</p>
                      <p className="text-xs text-muted">{formatDate(p.at)}</p>
                    </div>
                    <Badge tone={LEVEL_TONE[p.level] || 'neutral'}>
                      {p.confidence?.toFixed?.(0)}%
                    </Badge>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                <ScanLine size={16} className="text-primary" /> Recent scans
              </h4>
              <div className="space-y-2">
                {reports.length === 0 && <p className="text-sm text-muted">None yet.</p>}
                {reports.map((r) => (
                  <div key={r.id} className="flex items-center justify-between rounded-xl bg-surface-2 p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {r.fileName || 'Prescription'}
                      </p>
                      <p className="text-xs text-muted">{formatDate(r.at)}</p>
                    </div>
                    <Badge tone="primary">{r.medicineCount} meds</Badge>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}

function Field({ icon: Icon, label, value, onChange }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-foreground">{label}</span>
      <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-3">
        <Icon size={16} className="text-muted" />
        <input
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          className="h-11 flex-1 bg-transparent text-sm text-foreground outline-none"
        />
      </div>
    </label>
  )
}
