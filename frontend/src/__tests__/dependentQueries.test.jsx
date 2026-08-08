import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { buildClientMock, routeGet } from '@/test/apiMock'
import { renderRoute, waitForRoute } from '@/test/renderRoute'
import { API } from '@/shared/api/client'

/**
 * Patient Context and Digital Twin both run a list query and a detail query
 * keyed on the selected patient. Two lines carry that whole arrangement:
 *
 *     const patientId = selectedId || patients[0]?.patient_id || ''
 *     enabled: Boolean(patientId)
 *
 * Delete the fallback and the page loads to a permanently blank detail pane
 * until the user touches the dropdown. Delete the `enabled` guard and the page
 * fires `GET /patient-context/` — a request for the empty string — on every
 * mount before the list arrives, which 404s against the real backend. The route
 * tests catch neither: they prove a page mounts, and a page with no detail
 * mounts perfectly well.
 *
 * So these tests assert on the requests actually issued, and on the selected
 * patient's data reaching the screen without anyone clicking anything.
 */

vi.mock('@/shared/api/client', () => buildClientMock())

const PATIENTS = [
  { patient_id: 'asha-rao', patient_name: 'Asha Rao', event_count: 4, report_count: 4 },
  { patient_id: 'raj-mehta', patient_name: 'Raj Mehta', event_count: 2, report_count: 2 },
]

const DECISIONS = [
  { trace_id: 'trace-newest', patient_name: 'Asha Rao', top_disease: 'Anaemia', created_at: '2026-08-04T09:00:00Z' },
  { trace_id: 'trace-older', patient_name: 'Raj Mehta', top_disease: 'Migraine', created_at: '2026-08-01T09:00:00Z' },
]

let contexts = []
let decisions = []
let detailGets = []
let twinGets = []
let pipelineGets = []

/** The detail response for a patient-context id. */
const contextOf = (id) => {
  const p = contexts.find((c) => c.patient_id === id)
  return {
    profile: {
      patient_name: p ? p.patient_name : `unknown:${id}`,
      age: 41,
      gender: 'F',
      event_count: p?.event_count ?? 0,
      current_medicines: [],
      known_conditions: [],
      follow_up_recommendations: [],
    },
    conversation: [],
    ocr_history: [],
    medicine_timeline: [],
    disease_timeline: [],
    interaction_history: [],
  }
}

beforeEach(() => {
  contexts = [...PATIENTS]
  decisions = [...DECISIONS]
  detailGets = []
  twinGets = []
  pipelineGets = []

  // Order matters: the list URLs are prefixes of the detail URLs, so they have
  // to be matched first.
  routeGet(API, {
    '/patient-context/history': () => ({ items: [...contexts] }),
    '/patient-context/': (url) => {
      const id = decodeURIComponent(url.split('/patient-context/')[1] || '')
      detailGets.push(id)
      return contextOf(id)
    },
    '/digital-twin/patients': () => [...contexts],
    '/digital-twin/': (url) => {
      const id = decodeURIComponent(url.split('/digital-twin/')[1] || '')
      twinGets.push(id)
      return { patient_id: id, report_count: 0, ai_summary: `Nothing recorded for ${id}` }
    },
    // `/governance/decisions/<id>/pipeline` shares its prefix with the list
    // endpoint, so the more specific one is matched by its suffix first.
    '/pipeline': (url) => {
      const id = decodeURIComponent(url.split('/decisions/')[1].replace('/pipeline', ''))
      pipelineGets.push(id)
      return { trace_id: id, status: 'success', total_time: 1.5, steps: [] }
    },
    '/governance/decisions': () => ({ items: [...decisions] }),
  })
})

/** jsdom's `confirm` is a no-op returning undefined, which reads as "cancel". */
const acceptConfirm = () => vi.spyOn(window, 'confirm').mockReturnValue(true)

/** A DELETE that actually removes the patient from the fake server's list. */
const fakeDelete = () =>
  API.delete.mockImplementation(async (url) => {
    const id = decodeURIComponent(url.split('/patient-context/')[1] || '')
    contexts = contexts.filter((c) => c.patient_id !== id)
    return { data: { status: 'ok' } }
  })

describe('patient context', () => {
  it('loads the first patient without being asked', async () => {
    renderRoute('/patients/context')
    await waitForRoute()

    expect(await screen.findByText('Asha Rao')).toBeInTheDocument()
    await waitFor(() => expect(detailGets).toEqual(['asha-rao']))
  })

  it('asks for nothing when there are no patients', async () => {
    contexts = []
    renderRoute('/patients/context')
    await waitForRoute()

    expect(await screen.findByText(/No patient memory yet/i)).toBeInTheDocument()
    // A request for the empty patient id is the failure this guards against.
    expect(detailGets).toEqual([])
  })

  it('loads the patient chosen from the dropdown', async () => {
    const user = userEvent.setup()
    renderRoute('/patients/context')
    await waitForRoute()
    await screen.findByText('Asha Rao')

    const main = within(screen.getByRole('main'))
    await user.selectOptions(main.getByRole('combobox'), 'raj-mehta')

    expect(await screen.findByText('Raj Mehta')).toBeInTheDocument()
    await waitFor(() => expect(detailGets).toEqual(['asha-rao', 'raj-mehta']))
  })

  it('falls back to the next patient after the selected one is deleted', async () => {
    const user = userEvent.setup()
    acceptConfirm()
    fakeDelete()

    renderRoute('/patients/context')
    await waitForRoute()
    await screen.findByText('Asha Rao')

    await user.click(screen.getByRole('button', { name: /Forget/i }))

    // The selection is derived, not stored, so dropping the first patient
    // promotes the second one instead of leaving a dangling id on screen.
    expect(await screen.findByText('Raj Mehta')).toBeInTheDocument()
    await waitFor(() => expect(detailGets.at(-1)).toBe('raj-mehta'))
  })

  it('clears an explicit selection when that patient is deleted', async () => {
    const user = userEvent.setup()
    acceptConfirm()
    fakeDelete()

    renderRoute('/patients/context')
    await waitForRoute()
    await screen.findByText('Asha Rao')

    // Deleting the *explicitly chosen* patient is the case the derived
    // fallback alone does not cover: `selectedId` still names a patient that
    // no longer exists, so without the reset the page keeps requesting a dead
    // id and renders whatever the backend returns for it.
    const main = within(screen.getByRole('main'))
    await user.selectOptions(main.getByRole('combobox'), 'raj-mehta')
    await screen.findByText('Raj Mehta')

    await user.click(screen.getByRole('button', { name: /Forget/i }))

    expect(await screen.findByText('Asha Rao')).toBeInTheDocument()
    expect(screen.queryByText(/Raj Mehta|unknown:/)).not.toBeInTheDocument()
    expect(detailGets).not.toContain('unknown:raj-mehta')
  })
})

describe('pipeline viewer', () => {
  it('shows the newest decision without being asked', async () => {
    renderRoute('/governance/pipeline')
    await waitForRoute()

    expect(await screen.findByText('trace-newest')).toBeInTheDocument()
    await waitFor(() => expect(pipelineGets).toEqual(['trace-newest']))
  })

  it('honours a ?trace= deep link instead of the first decision', async () => {
    renderRoute('/governance/pipeline?trace=trace-older')
    await waitForRoute()

    expect(await screen.findByText('trace-older')).toBeInTheDocument()
    expect(pipelineGets).toEqual(['trace-older'])
  })

  it('asks for no pipeline when there are no decisions', async () => {
    decisions = []
    renderRoute('/governance/pipeline')
    await waitForRoute()

    expect(await screen.findByText(/No decisions to visualise/i)).toBeInTheDocument()
    expect(pipelineGets).toEqual([])
  })

  it('puts the chosen trace in the url, which is what drives the fetch', async () => {
    const user = userEvent.setup()
    renderRoute('/governance/pipeline')
    await waitForRoute()
    await screen.findByText('trace-newest')

    const main = within(screen.getByRole('main'))
    await user.selectOptions(main.getByRole('combobox'), 'trace-older')

    // The select has no state of its own: it writes the URL and re-renders
    // from it, so a wrong wiring here shows up as a stale dropdown.
    expect(await screen.findByText('trace-older')).toBeInTheDocument()
    await waitFor(() => expect(pipelineGets).toEqual(['trace-newest', 'trace-older']))
    expect(main.getByRole('combobox')).toHaveValue('trace-older')
  })
})

describe('digital twin', () => {
  it('builds the first patient’s twin without being asked', async () => {
    renderRoute('/patients/digital-twin')
    await waitForRoute()

    expect(await screen.findByText(/Nothing recorded for asha-rao/)).toBeInTheDocument()
    await waitFor(() => expect(twinGets).toEqual(['asha-rao']))
  })

  it('asks for nothing when there are no patients', async () => {
    contexts = []
    renderRoute('/patients/digital-twin')
    await waitForRoute()

    expect(await screen.findByText(/No patient data yet/i)).toBeInTheDocument()
    expect(twinGets).toEqual([])
  })
})
