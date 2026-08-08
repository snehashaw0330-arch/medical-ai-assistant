import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { buildClientMock, routeGet, routePost } from '@/test/apiMock'
import { renderRoute, waitForRoute } from '@/test/renderRoute'
import { API } from '@/shared/api/client'

/**
 * The governance overview and the document analyser.
 *
 * Document Intelligence is the dress rehearsal for `PrescriptionOCR`: an upload
 * with progress reporting and an `AbortSignal`. Those two survive the migration
 * unchanged, and a cancelled upload must stay what it always was — a user
 * action, not an error to report. That distinction is the thing most easily
 * lost when a hand-rolled `catch` becomes a mutation's error state, so it has a
 * test of its own.
 */

vi.mock('@/shared/api/client', () => buildClientMock())

let dashboardGets = 0
let documentHistoryGets = 0
let documents = []

beforeEach(() => {
  dashboardGets = 0
  documentHistoryGets = 0
  documents = [{ id: 'd-1', filename: 'labs.pdf', document_type: 'blood_test_report', created_at: '2026-08-01T09:00:00Z' }]

  routeGet(API, {
    '/governance/dashboard': () => {
      dashboardGets += 1
      return {
        total_decisions: 12,
        decisions_over_time: [],
        top_diseases: [],
        top_medicines: [],
        average_confidence: 0.8,
      }
    },
    '/governance/versions': () => ({ model_version: 'v1', dataset_version: 'd1' }),
    '/governance/decisions': (_url, config) => ({
      items: [{ trace_id: 't-1', patient_name: 'Asha Rao', top_disease: 'anaemia', status: 'success', confidence: 0.9, created_at: '2026-08-01T09:00:00Z', _q: config?.params?.patient }],
    }),
    '/documents/history': () => {
      documentHistoryGets += 1
      return { items: [...documents] }
    },
    '/documents/': (url) => ({
      id: url.split('/documents/')[1],
      filename: 'stored.pdf',
      document_type: 'blood_test_report',
      clinical_summary: { summary: 'A stored document summary.', provider: 'offline' },
    }),
  })

  routePost(API, {
    '/governance/sync': () => ({ message: 'Synced 3 decisions' }),
    '/documents/analyze': () => ({
      id: 'd-2',
      filename: 'upload.png',
      document_type: 'blood_test_report',
      clinical_summary: { summary: 'A fresh document summary.', provider: 'offline' },
    }),
  })

  API.delete.mockImplementation(async (url) => {
    const id = url.split('/documents/')[1]
    documents = documents.filter((d) => d.id !== id)
    return { data: { status: 'ok' } }
  })
})

describe('ai governance', () => {
  it('does not search the decision traces while the boxes are typed into', async () => {
    const user = userEvent.setup()
    renderRoute('/governance')
    await waitForRoute()

    const main = within(screen.getByRole('main'))
    const searchCalls = () =>
      API.get.mock.calls.filter(([url]) => url === '/governance/decisions').length
    await waitFor(() => expect(searchCalls()).toBe(1))

    await user.type(main.getByPlaceholderText(/patient/i), 'Asha')
    expect(searchCalls()).toBe(1)

    await user.click(main.getByRole('button', { name: /^Search$/i }))
    await waitFor(() => expect(searchCalls()).toBe(2))
  })

  it('refreshes everything after a sync', async () => {
    const user = userEvent.setup()
    renderRoute('/governance')
    await waitForRoute()
    await waitFor(() => expect(dashboardGets).toBe(1))

    const main = within(screen.getByRole('main'))
    await user.click(main.getByRole('button', { name: /Sync/i }))

    // A sync rewrites the store, so the dashboard it is showing is stale.
    expect(await screen.findByText(/Synced 3 decisions/)).toBeInTheDocument()
    await waitFor(() => expect(dashboardGets).toBe(2))
  })
})

describe('document intelligence', () => {
  const upload = async (user) => {
    const file = new File(['x'], 'upload.png', { type: 'image/png' })
    const input = document.querySelector('input[type="file"]')
    await user.upload(input, file)
  }

  it('analyses an upload and refreshes the recent list', async () => {
    const user = userEvent.setup()
    renderRoute('/intake/documents')
    await waitForRoute()
    await waitFor(() => expect(documentHistoryGets).toBe(1))

    await upload(user)
    await user.click(screen.getByRole('button', { name: /Analyze|Analyse/i }))

    expect(await screen.findByText(/A fresh document summary/)).toBeInTheDocument()
    await waitFor(() => expect(documentHistoryGets).toBe(2))
  })

  it('treats a cancelled upload as a cancellation, not a failure', async () => {
    const user = userEvent.setup()
    // An analyse request that never resolves until it is aborted, which is what
    // the real one does for a large scan.
    API.post.mockImplementation(
      (url, _form, config) =>
        new Promise((resolve, reject) => {
          if (!url.includes('/documents/analyze')) return resolve({ data: {} })
          config?.signal?.addEventListener('abort', () => {
            const err = new Error('canceled')
            err.code = 'ERR_CANCELED'
            err.name = 'CanceledError'
            reject(err)
          })
        }),
    )

    renderRoute('/intake/documents')
    await waitForRoute()
    await upload(user)
    await user.click(screen.getByRole('button', { name: /Analyze|Analyse/i }))

    const cancel = await screen.findByRole('button', { name: /Cancel/i })
    await user.click(cancel)

    // No error banner at all. Asserting only on the fallback wording would
    // miss it: `errorMessage` prefers the error's own message, so a cancelled
    // request surfaces as a banner reading "canceled" instead. The banner is
    // identified by its Retry button, which exists nowhere else.
    await waitFor(() => expect(screen.getByRole('button', { name: /Analyze|Analyse/i })).toBeEnabled())
    expect(screen.queryByRole('button', { name: /Retry/i })).not.toBeInTheDocument()
  })

  it('opens a stored document over a fresh analysis', async () => {
    const user = userEvent.setup()
    renderRoute('/intake/documents')
    await waitForRoute()

    await upload(user)
    await user.click(screen.getByRole('button', { name: /Analyze|Analyse/i }))
    expect(await screen.findByText(/A fresh document summary/)).toBeInTheDocument()

    // The analysis is still held, so opening has to clear it — the precedence
    // rule `analyze.data ?? open.data` only decides the other direction.
    const main = within(screen.getByRole('main'))
    await user.click(await main.findByRole('button', { name: /labs\.pdf/i }))

    expect(await screen.findByText(/A stored document summary/)).toBeInTheDocument()
    expect(screen.queryByText(/A fresh document summary/)).not.toBeInTheDocument()
  })

  it('refreshes the recent list after deleting a record', async () => {
    const user = userEvent.setup()
    renderRoute('/intake/documents')
    await waitForRoute()
    await screen.findByText(/labs\.pdf/i)

    const main = within(screen.getByRole('main'))
    await user.click(main.getByRole('button', { name: /Delete/i }))

    await waitFor(() => expect(screen.queryByText(/labs\.pdf/i)).not.toBeInTheDocument())
  })
})
