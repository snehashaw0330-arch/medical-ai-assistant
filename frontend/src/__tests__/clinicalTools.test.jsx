import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { buildClientMock, routeGet, routePost } from '@/test/apiMock'
import { renderRoute, waitForRoute } from '@/test/renderRoute'
import { API } from '@/shared/api/client'

/**
 * Symptom Checker and Treatment Simulator — the last two clinical pages.
 *
 * The Symptom Checker's *honesty* behaviour (no guessing, refusal floors) is
 * Phase 4's and is covered by `symptomHonesty.test.jsx`. This file covers only
 * what the query migration changed: the guard that stops an empty analysis, and
 * the persisted-run lists that have to refresh themselves.
 */

vi.mock('@/shared/api/client', () => buildClientMock())

let symptomHistoryGets = 0
let simulationHistoryGets = 0

beforeEach(() => {
  symptomHistoryGets = 0
  simulationHistoryGets = 0

  routeGet(API, {
    '/symptoms/catalog': () => ({
      categories: [{ label: 'General', symptoms: ['fever', 'cough'] }],
    }),
    '/symptoms/history': () => {
      symptomHistoryGets += 1
      return { items: [] }
    },
    '/symptoms': () => ['fever', 'cough'],
    '/simulation/history': () => {
      simulationHistoryGets += 1
      return { items: [{ id: 's-1', created_at: '2026-08-01T09:00:00Z', scenario_count: 1, top_disease: 'anaemia', baseline_risk: 'low', medicine_count: 2 }] }
    },
    '/simulation/': (url) => ({
      id: url.split('/simulation/')[1],
      summary: 'Stored baseline summary.',
      baseline: { scenario_id: 'baseline', scenario_name: 'Stored baseline', is_baseline: true, risk_level: 'low', risk_score: 20, resulting_medicines: [], side_effects: [], confidence: { overall: 80 } },
      results: [],
      recommended_scenario_id: 'baseline',
    }),
  })

  routePost(API, {
    '/symptoms/analyze': () => ({
      possible_conditions: [{ disease: 'Common cold', probability: 0.6, confidence: 60 }],
      red_flags: [],
      urgency: 'self_care',
      advice: ['Rest and fluids'],
    }),
    '/simulation/run': () => ({
      summary: 'Fresh baseline summary.',
      baseline: { scenario_id: 'baseline', scenario_name: 'Fresh baseline', is_baseline: true, risk_level: 'low', risk_score: 10, resulting_medicines: [], side_effects: [], confidence: { overall: 80 } },
      results: [],
      recommended_scenario_id: 'baseline',
    }),
  })
})

describe('symptom checker', () => {
  it('cannot be analysed with nothing selected', async () => {
    renderRoute('/clinical/symptoms')
    await waitForRoute()

    // The button is disabled rather than guarded by the toast, so nothing can
    // reach the analysis in the first place.
    const main = within(screen.getByRole('main'))
    expect(main.getByRole('button', { name: /Generate Assessment/i })).toBeDisabled()
    expect(API.post).not.toHaveBeenCalled()
  })

  it('refreshes the recent list after an analysis', async () => {
    const user = userEvent.setup()
    renderRoute('/clinical/symptoms')
    await waitForRoute()
    await waitFor(() => expect(symptomHistoryGets).toBe(1))

    await user.type(screen.getByPlaceholderText(/Search symptoms/i), 'fever{Enter}')
    const main = within(screen.getByRole('main'))
    await user.click(main.getByRole('button', { name: /Generate Assessment/i }))

    expect(await screen.findByText(/Common cold/i)).toBeInTheDocument()
    // `persist: true` — the recent list underneath is stale.
    await waitFor(() => expect(symptomHistoryGets).toBe(2))
  })
})

describe('treatment simulator', () => {
  it('refreshes the recent list after a simulation', async () => {
    const user = userEvent.setup()
    renderRoute('/clinical/simulator')
    await waitForRoute()
    await waitFor(() => expect(simulationHistoryGets).toBe(1))

    // The page ships with two baseline medicines, so it can run as-is.
    await user.click(screen.getByRole('button', { name: /Run Simulation/i }))

    // The name appears in the summary, the scenario card and the detail
    // heading, so this is deliberately an "at least one" assertion.
    expect(await screen.findAllByText(/Fresh baseline/)).not.toHaveLength(0)
    await waitFor(() => expect(simulationHistoryGets).toBe(2))
  })

  it('shows a fresh simulation over the stored one opened before it', async () => {
    const user = userEvent.setup()
    renderRoute('/clinical/simulator')
    await waitForRoute()

    const main = within(screen.getByRole('main'))
    await user.click(await main.findByRole('button', { name: /Anaemia/i }))
    expect(await screen.findAllByText(/Stored baseline/)).not.toHaveLength(0)

    await user.click(screen.getByRole('button', { name: /Run Simulation/i }))
    expect(await screen.findAllByText(/Fresh baseline/)).not.toHaveLength(0)
    expect(screen.queryAllByText(/Stored baseline/)).toHaveLength(0)

    // And back the other way, which the precedence alone does not cover.
    await user.click(main.getByRole('button', { name: /Anaemia/i }))
    expect(await screen.findAllByText(/Stored baseline/)).not.toHaveLength(0)
    expect(screen.queryAllByText(/Fresh baseline/)).toHaveLength(0)
  })
})
