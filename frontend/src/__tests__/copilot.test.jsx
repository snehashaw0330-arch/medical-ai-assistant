import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { buildClientMock, routeGet, routePost } from '@/test/apiMock'
import { renderRoute, waitForRoute } from '@/test/renderRoute'
import { API } from '@/shared/api/client'

/**
 * The Copilot workspace, which is the only page with a *remembered* session:
 * the id lives in localStorage and the patient context is re-read from the
 * server on every mount.
 *
 * Two things there are easy to get wrong and invisible when wrong. A session
 * the server has forgotten must be dropped locally, or every reload retries a
 * dead id forever. And the chat transcript now lives in the query cache rather
 * than in component state, so both turns of an exchange have to land in the
 * same place the session's own messages came from.
 */

vi.mock('@/shared/api/client', () => buildClientMock())

const SESSION_KEY = 'copilot_session_id'

let contextGets = []
let sessionExists = true

beforeEach(() => {
  contextGets = []
  sessionExists = true
  localStorage.clear()

  routeGet(API, {
    '/copilot/context': (_url, config) => {
      const id = config?.params?.session_id
      contextGets.push(id)
      if (!sessionExists) {
        const err = new Error('Session not found')
        err.response = { status: 404, data: { detail: 'Session not found' } }
        throw err
      }
      return {
        context: { patient_name: 'Asha Rao', timeline: [] },
        messages: [{ role: 'assistant', content: 'Remembered greeting', at: '2026-08-01T09:00:00Z' }],
        last_analysis: null,
      }
    },
    '/copilot/pipeline': () => [],
    '/symptoms': () => ['fever'],
  })

  routePost(API, {
    '/copilot/analyze': () => ({
      session_id: 'sess-new',
      summary: 'A fresh copilot analysis.',
      drug_interactions: { interactions: [] },
      activity: [],
    }),
    '/copilot/chat': (_url, payload) => ({
      reply: `answer to ${payload.message}`,
      references: [],
      at: '2026-08-05T09:00:00Z',
    }),
  })
})

afterEach(() => localStorage.clear())

describe('copilot workspace', () => {
  it('rehydrates a remembered session on mount', async () => {
    localStorage.setItem(SESSION_KEY, 'sess-1')
    renderRoute('/copilot')
    await waitForRoute()

    expect(await screen.findByText(/Remembered greeting/)).toBeInTheDocument()
    expect(contextGets).toEqual(['sess-1'])
  })

  it('forgets a session the server no longer knows', async () => {
    localStorage.setItem(SESSION_KEY, 'sess-dead')
    sessionExists = false
    renderRoute('/copilot')
    await waitForRoute()

    // Otherwise every reload retries a dead id for as long as the browser
    // remembers it.
    await waitFor(() => expect(localStorage.getItem(SESSION_KEY)).toBeNull())
  })

  it('asks for no session when none is remembered', async () => {
    renderRoute('/copilot')
    await waitForRoute()

    expect(contextGets).toEqual([])
  })

  it('keeps both turns of a chat exchange in the transcript', async () => {
    const user = userEvent.setup()
    localStorage.setItem(SESSION_KEY, 'sess-1')
    renderRoute('/copilot')
    await waitForRoute()
    await screen.findByText(/Remembered greeting/)

    await user.type(screen.getByPlaceholderText(/Ask about this patient/i), 'is this safe')
    await user.click(screen.getByRole('button', { name: /Send/i }))

    // The user's turn is posted immediately, the reply when it lands, and the
    // session's own greeting is still there — one transcript, not two.
    expect(await screen.findByText('is this safe')).toBeInTheDocument()
    expect(await screen.findByText(/answer to is this safe/)).toBeInTheDocument()
    expect(screen.getByText(/Remembered greeting/)).toBeInTheDocument()
  })

  it('remembers the session an analysis creates and re-reads it', async () => {
    const user = userEvent.setup()
    renderRoute('/copilot')
    await waitForRoute()

    const main = within(screen.getByRole('main'))
    await user.type(main.getByPlaceholderText(/Medicines/i), 'aspirin{Enter}')
    await user.click(main.getByRole('button', { name: /Run Copilot/i }))

    await waitFor(() => expect(localStorage.getItem(SESSION_KEY)).toBe('sess-new'))
    // The analysis rewrites the patient context, so the session is re-read.
    await waitFor(() => expect(contextGets).toContain('sess-new'))
  })

  it('re-reads the context after a second analysis on the same session', async () => {
    const user = userEvent.setup()
    // Already on the session the analysis will return, so the query key does
    // not change — only an explicit invalidation can refresh the context. With
    // a *new* session the key change hides that, which is why this test uses
    // the same id.
    localStorage.setItem(SESSION_KEY, 'sess-new')
    renderRoute('/copilot')
    await waitForRoute()
    await waitFor(() => expect(contextGets).toEqual(['sess-new']))

    const main = within(screen.getByRole('main'))
    await user.type(main.getByPlaceholderText(/Medicines/i), 'aspirin{Enter}')
    await user.click(main.getByRole('button', { name: /Run Copilot/i }))

    await waitFor(() => expect(contextGets).toEqual(['sess-new', 'sess-new']))
  })

  it('starts a new session on reset', async () => {
    const user = userEvent.setup()
    localStorage.setItem(SESSION_KEY, 'sess-1')
    renderRoute('/copilot')
    await waitForRoute()
    await screen.findByText(/Remembered greeting/)

    const main = within(screen.getByRole('main'))
    await user.click(main.getByRole('button', { name: /New (patient|session)/i }))

    expect(localStorage.getItem(SESSION_KEY)).toBeNull()
    await waitFor(() => expect(screen.queryByText(/Remembered greeting/)).not.toBeInTheDocument())
  })
})
