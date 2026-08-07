import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { buildClientMock, routeGet, routePost } from '@/test/apiMock'
import { renderRoute, waitForRoute } from '@/test/renderRoute'
import { API } from '@/shared/api/client'

/**
 * Clinical Decision and Clinical Reasoning: the same ask/open shape as the
 * Evidence tabs, on the pages where being wrong matters most.
 *
 * Both share the symptom vocabulary behind their autocomplete, which is the one
 * new thing here — a single query key means the second page to mount serves it
 * from cache instead of re-downloading the list.
 */

vi.mock('@/shared/api/client', () => buildClientMock())

let clinicalHistoryGets = 0
let reasoningHistoryGets = 0
let symptomGets = 0

beforeEach(() => {
  clinicalHistoryGets = 0
  reasoningHistoryGets = 0
  symptomGets = 0

  routeGet(API, {
    '/symptoms': () => {
      symptomGets += 1
      return ['chest pain', 'fever']
    },
    '/clinical/history': () => {
      clinicalHistoryGets += 1
      return { items: [{ id: 'c-1', top_disease: 'anaemia', risk_level: 'low', created_at: '2026-08-01T09:00:00Z', medicine_count: 1 }] }
    },
    '/clinical/': (url) => ({
      id: url.split('/clinical/')[1],
      clinical_summary: 'A stored clinical summary.',
      risk_level: 'low',
      confidence: 71,
      risk_score: 20,
    }),
    '/reasoning/pipeline': () => ({ steps: [{ order: 1, key: 'ocr', name: 'Server-defined OCR step' }] }),
    '/reasoning/history': () => {
      reasoningHistoryGets += 1
      return { items: [{ id: 'r-1', leading_disease: 'migraine', risk_level: 'low', confidence: 70, created_at: '2026-08-01T09:00:00Z', medicine_count: 1 }] }
    },
    '/reasoning/': (url) => ({
      id: url.split('/reasoning/')[1],
      patient_summary: { narrative: 'A stored reasoning summary.' },
      risk_level: 'low',
      confidence: 71,
    }),
  })

  routePost(API, {
    '/clinical/analyze': () => ({
      id: 'c-2',
      clinical_summary: 'A fresh clinical summary.',
      risk_level: 'moderate',
      confidence: 88,
      risk_score: 51,
    }),
    '/reasoning/analyze': () => ({
      id: 'r-2',
      patient_summary: { narrative: 'A fresh reasoning summary.' },
      risk_level: 'moderate',
      confidence: 88,
    }),
  })
})

/** A reasoning run that stays pending, so the in-flight UI can be asserted. */
function slowAnalyze() {
  const routed = API.post.getMockImplementation()
  API.post.mockImplementation(async (url, ...rest) => {
    if (url.includes('/reasoning/analyze')) await new Promise((r) => setTimeout(r, 600))
    return routed(url, ...rest)
  })
}

/** Type a diagnosis, which is enough to satisfy the "not empty" guard. */
async function fillDiagnosis(user, text) {
  await user.type(screen.getByPlaceholderText(/e.g. Hypertension/i), text)
}

describe('clinical decision', () => {
  it('refuses to analyse an empty form', async () => {
    const user = userEvent.setup()
    renderRoute('/clinical/decision')
    await waitForRoute()

    await user.click(screen.getByRole('button', { name: /Analyze/i }))

    expect(await screen.findByText(/Add at least one medicine, symptom, or a diagnosis/i)).toBeInTheDocument()
    expect(API.post).not.toHaveBeenCalled()
  })

  it('refreshes the recent list after an analysis', async () => {
    const user = userEvent.setup()
    renderRoute('/clinical/decision')
    await waitForRoute()
    await waitFor(() => expect(clinicalHistoryGets).toBe(1))

    await fillDiagnosis(user, 'Hypertension')
    await user.click(screen.getByRole('button', { name: /Analyze/i }))

    expect(await screen.findByText(/A fresh clinical summary/)).toBeInTheDocument()
    // `persist: true`, so the list below is stale the moment this returns.
    await waitFor(() => expect(clinicalHistoryGets).toBe(2))
  })

  it('swaps between a stored report and a fresh one, both ways', async () => {
    const user = userEvent.setup()
    renderRoute('/clinical/decision')
    await waitForRoute()

    const main = within(screen.getByRole('main'))
    await user.click(await main.findByRole('button', { name: /Anaemia/i }))
    expect(await screen.findByText(/A stored clinical summary/)).toBeInTheDocument()

    await fillDiagnosis(user, 'Hypertension')
    await user.click(screen.getByRole('button', { name: /Analyze/i }))
    expect(await screen.findByText(/A fresh clinical summary/)).toBeInTheDocument()
    expect(screen.queryByText(/A stored clinical summary/)).not.toBeInTheDocument()

    await user.click(main.getByRole('button', { name: /Anaemia/i }))
    expect(await screen.findByText(/A stored clinical summary/)).toBeInTheDocument()
    expect(screen.queryByText(/A fresh clinical summary/)).not.toBeInTheDocument()
  })
})

describe('clinical reasoning', () => {
  it('prefers the server pipeline over the built-in fallback', async () => {
    const user = userEvent.setup()
    slowAnalyze()
    renderRoute('/clinical/reasoning')
    await waitForRoute()

    await fillDiagnosis(user, 'Migraine')
    await user.click(screen.getByRole('button', { name: /Run Reasoning/i }))

    // The diagram is only on screen while the run is in flight.
    expect(await screen.findByText(/Server-defined OCR step/)).toBeInTheDocument()
  })

  it('falls back to the built-in pipeline when the server has none', async () => {
    const user = userEvent.setup()
    routeGet(API, {
      '/reasoning/pipeline': () => ({ steps: [] }),
      '/reasoning/history': () => ({ items: [] }),
      '/symptoms': () => [],
    })
    slowAnalyze()
    renderRoute('/clinical/reasoning')
    await waitForRoute()

    await fillDiagnosis(user, 'Migraine')
    await user.click(screen.getByRole('button', { name: /Run Reasoning/i }))

    // An empty server list must not blank the diagram.
    expect(await screen.findByText(/Medicine Validation/)).toBeInTheDocument()
  })

  it('refreshes the recent list after a reasoning run', async () => {
    const user = userEvent.setup()
    renderRoute('/clinical/reasoning')
    await waitForRoute()
    await waitFor(() => expect(reasoningHistoryGets).toBe(1))

    await fillDiagnosis(user, 'Migraine')
    await user.click(screen.getByRole('button', { name: /Run Reasoning/i }))

    expect(await screen.findByText(/A fresh reasoning summary/)).toBeInTheDocument()
    await waitFor(() => expect(reasoningHistoryGets).toBe(2))
  })
})

describe('the shared symptom vocabulary', () => {
  it('is fetched once and reused by the second page', async () => {
    const user = userEvent.setup()
    renderRoute('/clinical/decision', { queryOptions: { staleTime: 60_000 } })
    await waitForRoute()
    await waitFor(() => expect(symptomGets).toBe(1))

    // Navigate to the other page that uses the same vocabulary.
    await user.click(screen.getByRole('link', { name: /Reasoning/i }))
    await waitFor(() => expect(screen.getByRole('main')).toBeInTheDocument())
    await new Promise((resolve) => setTimeout(resolve, 200))

    // One key for both pages, so the second mount costs nothing.
    expect(symptomGets).toBe(1)
  })
})
