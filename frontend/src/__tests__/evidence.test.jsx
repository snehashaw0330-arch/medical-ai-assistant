import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { buildClientMock, routeGet, routePost } from '@/test/apiMock'
import { renderRoute, waitForRoute } from '@/test/renderRoute'
import { API } from '@/shared/api/client'

/**
 * The two Evidence tabs, which are the first pages where "ask" and "open a past
 * one" are both modelled as mutations rather than queries.
 *
 * That is deliberate and worth pinning. Both actions exist to write into the
 * page — fill the form from a stored verification, append a turn to the chat
 * transcript, drop back to single-query mode — which as queries would need an
 * effect syncing state to fetched data, the exact pattern this phase removes.
 * The risk of modelling them this way is that the two results can both be
 * present at once and the wrong one wins, so each action resetting the other is
 * asserted directly.
 */

vi.mock('@/shared/api/client', () => buildClientMock())

let verifications = []
let evidenceRecords = []
let verificationHistoryGets = 0
let evidenceHistoryGets = 0

beforeEach(() => {
  verifications = [{ id: 'v-1', question: 'Is aspirin safe in pregnancy?', confidence: 71, evidence_coverage: 64, hallucination_risk: 'low', created_at: '2026-08-01T09:00:00Z' }]
  evidenceRecords = [{ id: 'e-1', query: 'ibuprofen and warfarin', created_at: '2026-08-01T09:00:00Z' }]
  verificationHistoryGets = 0
  evidenceHistoryGets = 0

  routeGet(API, {
    '/verification/history': () => {
      verificationHistoryGets += 1
      return { items: [...verifications] }
    },
    '/verification/': (url) => ({
      id: url.split('/verification/')[1],
      question: 'stored question',
      response: 'stored response',
      verdict: 'A stored verdict from the archive.',
      metrics: { confidence: 71, evidence_coverage: 64 },
      claims: [],
      sources: [],
    }),
    '/evidence/history': () => {
      evidenceHistoryGets += 1
      return { items: [...evidenceRecords] }
    },
    '/evidence/': (url) => ({
      id: url.split('/evidence/')[1],
      query: 'stored evidence query',
      response: 'A stored evidence answer.',
      confidence: 0.8,
      sources: [],
      chunks: [],
    }),
  })

  routePost(API, {
    '/verification/check': (_url, payload) => {
      verifications = [{ id: 'v-2', question: payload.question, confidence: 90, evidence_coverage: 88, hallucination_risk: 'low', created_at: '2026-08-05T09:00:00Z' }, ...verifications]
      return {
        id: 'v-2',
        question: payload.question,
        response: `VERIFIED: ${payload.response || 'A freshly generated answer.'}`,
        generated: !payload.response,
        verdict: 'Freshly verified against the knowledge base.',
        metrics: { confidence: 90, evidence_coverage: 88 },
        claims: [],
        sources: [],
      }
    },
    '/evidence/query': (_url, payload) => {
      evidenceRecords = [{ id: 'e-2', query: payload.query, created_at: '2026-08-05T09:00:00Z' }, ...evidenceRecords]
      return { id: 'e-2', query: payload.query, response: 'A fresh evidence answer.', confidence: 0.9, sources: [], chunks: [] }
    },
    '/evidence/chat': (_url, payload) => ({
      session_id: 'sess-1',
      response: `chat reply to ${payload.message}`,
      confidence: 0.85,
      sources: [],
      chunks: [],
    }),
  })
})

describe('evidence verification', () => {
  it('refreshes the recent list after a verification', async () => {
    const user = userEvent.setup()
    renderRoute('/knowledge/verify')
    await waitForRoute()
    await waitFor(() => expect(verificationHistoryGets).toBe(1))

    await user.type(screen.getByPlaceholderText(/What is metformin used for/i), 'Is paracetamol safe?')
    await user.click(screen.getByRole('button', { name: /Verify/i }))

    expect(await screen.findByText(/Freshly verified against the knowledge base/)).toBeInTheDocument()
    // Verifications are persisted, so the list underneath is stale.
    await waitFor(() => expect(verificationHistoryGets).toBe(2))
  })

  it('fills the form from a stored verification', async () => {
    const user = userEvent.setup()
    renderRoute('/knowledge/verify')
    await waitForRoute()

    const main = within(screen.getByRole('main'))
    await user.click(await main.findByRole('button', { name: /Is aspirin safe in pregnancy/i }))

    // Opening a past verification exists to write into the form.
    await waitFor(() =>
      expect(screen.getByPlaceholderText(/What is metformin used for/i)).toHaveValue('stored question'),
    )
    expect(screen.getByPlaceholderText(/Paste an AI-generated answer/i)).toHaveValue('stored response')
  })

  it('shows the new verification, not the one opened before it', async () => {
    const user = userEvent.setup()
    renderRoute('/knowledge/verify')
    await waitForRoute()

    const main = within(screen.getByRole('main'))
    await user.click(await main.findByRole('button', { name: /Is aspirin safe in pregnancy/i }))
    await waitFor(() =>
      expect(screen.getByPlaceholderText(/What is metformin used for/i)).toHaveValue('stored question'),
    )

    await user.click(screen.getByRole('button', { name: /Verify/i }))

    // Both mutations hold a result. The fresh one has to win, or the page
    // shows the report the user opened a moment ago as though it were the
    // answer to what they just asked.
    expect(await screen.findByText(/Freshly verified against the knowledge base/)).toBeInTheDocument()
    expect(screen.queryByText(/A stored verdict from the archive/)).not.toBeInTheDocument()
    await waitFor(() => expect(verificationHistoryGets).toBe(2))
  })

  it('shows the opened report, not the verification before it', async () => {
    const user = userEvent.setup()
    renderRoute('/knowledge/verify')
    await waitForRoute()

    await user.type(screen.getByPlaceholderText(/What is metformin used for/i), 'Is paracetamol safe?')
    await user.click(screen.getByRole('button', { name: /Verify/i }))
    await screen.findByText(/Freshly verified against the knowledge base/)

    const main = within(screen.getByRole('main'))
    await user.click(await main.findByRole('button', { name: /Is aspirin safe in pregnancy/i }))

    // The other direction, which the precedence does not handle by itself: the
    // verification is still held, so opening has to clear it.
    expect(await screen.findByText(/A stored verdict from the archive/)).toBeInTheDocument()
    expect(screen.queryByText(/Freshly verified against/)).not.toBeInTheDocument()
  })
})

describe('evidence explorer', () => {
  it('asks a single query and refreshes the recent list', async () => {
    const user = userEvent.setup()
    renderRoute('/knowledge/evidence')
    await waitForRoute()
    await waitFor(() => expect(evidenceHistoryGets).toBe(1))

    await user.type(screen.getByPlaceholderText(/drug interactions of ibuprofen/i), 'aspirin dosing')
    await user.click(screen.getByRole('button', { name: /Get Evidence-Based Answer/i }))

    expect(await screen.findByText(/A fresh evidence answer/)).toBeInTheDocument()
    await waitFor(() => expect(evidenceHistoryGets).toBe(2))
  })

  it('keeps both turns of a chat exchange', async () => {
    const user = userEvent.setup()
    renderRoute('/knowledge/evidence')
    await waitForRoute()

    await user.click(screen.getByRole('button', { name: /Chat Session/i }))
    await user.type(screen.getByPlaceholderText(/drug interactions of ibuprofen/i), 'what about warfarin')
    await user.click(screen.getByRole('button', { name: /^Send$/i }))

    // The user's turn is posted immediately, the assistant's on the answer.
    expect(await screen.findByText('what about warfarin')).toBeInTheDocument()
    expect(await screen.findByText(/chat reply to what about warfarin/)).toBeInTheDocument()
  })

  it('shows a fresh answer over the record opened before it', async () => {
    const user = userEvent.setup()
    renderRoute('/knowledge/evidence')
    await waitForRoute()

    const main = within(screen.getByRole('main'))
    await user.click(await main.findByRole('button', { name: /ibuprofen and warfarin/i }))
    await screen.findByText(/A stored evidence answer/)

    await user.type(screen.getByPlaceholderText(/drug interactions of ibuprofen/i), 'aspirin dosing')
    await user.click(screen.getByRole('button', { name: /Get Evidence-Based Answer/i }))

    // Both hold a result at this point; the one the user just asked for wins.
    expect(await screen.findByText(/A fresh evidence answer/)).toBeInTheDocument()
    expect(screen.queryByText(/A stored evidence answer/)).not.toBeInTheDocument()
  })

  it('drops out of chat mode when a stored record is opened', async () => {
    const user = userEvent.setup()
    renderRoute('/knowledge/evidence')
    await waitForRoute()

    await user.click(screen.getByRole('button', { name: /Chat Session/i }))
    await user.type(screen.getByPlaceholderText(/drug interactions of ibuprofen/i), 'hello')
    await user.click(screen.getByRole('button', { name: /^Send$/i }))
    await screen.findByText(/chat reply to hello/)

    const main = within(screen.getByRole('main'))
    await user.click(await main.findByRole('button', { name: /ibuprofen and warfarin/i }))

    expect(await screen.findByText(/A stored evidence answer/)).toBeInTheDocument()
    // The transcript belongs to the session that was abandoned.
    expect(screen.queryByText(/chat reply to hello/)).not.toBeInTheDocument()
  })
})
