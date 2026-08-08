import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { buildClientMock, routeGet, routePost } from '@/test/apiMock'
import { renderRoute, waitForRoute } from '@/test/renderRoute'
import { API } from '@/shared/api/client'

/**
 * The last page migrated to the query hooks, and the only one whose numbers are
 * known to be meaningless: the model behind them is trained on 304 unique rows
 * duplicated 16x, so it scores a perfect top-1 against its own data. The scores
 * are still shown — they order the list usefully — so what has to hold is that
 * they are never shown *unqualified*.
 *
 * The refusal path lives in `symptomHonesty.test.jsx`, which fixes its mock to a
 * refusal at module level and so cannot also exercise a successful prediction.
 */

vi.mock('@/shared/api/client', () => buildClientMock())

const PREDICTION = {
  predictions: [
    {
      disease: 'Malaria',
      confidence: 97.3,
      explanation: 'Fever with a periodic pattern.',
      matched_symptoms: ['fever'],
    },
    {
      disease: 'Dengue',
      confidence: 41.2,
      explanation: 'Overlapping febrile presentation.',
      matched_symptoms: ['fever'],
    },
  ],
  resolved_symptoms: [{ input: 'fever', matched: 'fever' }],
  unmatched_inputs: [],
  suggested_symptoms: [],
  confidence_level: 'high',
  warnings: [],
  disclaimer: 'This is an AI triage aid, not a medical diagnosis.',
}

const REFUSAL = {
  ...PREDICTION,
  predictions: [],
  resolved_symptoms: [],
  confidence_level: 'low',
  warnings: ['A single symptom cannot distinguish between 41 conditions.'],
}

// Every symptom the page offers, and every prediction payload it sent.
let predictCalls = []
let response = PREDICTION

beforeEach(() => {
  // Not cleared by the harness, and the page seeds "Recent checks" from it —
  // one test's saved prediction is the next test's pre-existing history.
  localStorage.clear()
  predictCalls = []
  response = PREDICTION
  routeGet(API, {
    '/disease/symptoms': () => ({ symptoms: ['fever', 'chills', 'headache'] }),
  })
  routePost(API, {
    '/disease/predict': (_url, payload) => {
      predictCalls.push(payload)
      return response
    },
  })
})

/** Enter a symptom and run the first prediction. */
async function predictFor(user, symptom) {
  renderRoute('/clinical/disease')
  await waitForRoute()
  // TagInput renders role="combobox", not a plain textbox.
  await user.type(screen.getByRole('combobox'), `${symptom}{Enter}`)
  await user.click(screen.getByRole('button', { name: /Check Symptoms/i }))
}

describe('disease prediction labels its confidence numbers', () => {
  it('qualifies the scores as demo data once results are on screen', async () => {
    const user = userEvent.setup()
    await predictFor(user, 'fever')

    // The score itself is rendered...
    expect(await screen.findByText('97.3%')).toBeInTheDocument()
    // ...and never on its own. Without this the badge reads "97.3% — High",
    // which is indistinguishable from a calibrated probability.
    expect(screen.getByText(/Demo dataset/i)).toBeInTheDocument()
    expect(screen.getByText(/not calibrated probabilities/i)).toBeInTheDocument()
  })

  it('does not qualify numbers on the refusal screen, where there are none', async () => {
    const user = userEvent.setup()
    response = REFUSAL
    await predictFor(user, 'fever')

    expect(
      await screen.findByText(/single symptom cannot distinguish/i),
    ).toBeInTheDocument()
    // The note explains percentages. With nothing ranked it explains nothing
    // and competes with the refusal reason for the reader's attention.
    expect(screen.queryByText(/Demo dataset/i)).not.toBeInTheDocument()
  })
})

describe('disease prediction query migration', () => {
  it('predicts on the symptoms a follow-up just added, not the previous set', async () => {
    const user = userEvent.setup()
    await predictFor(user, 'fever')
    await waitFor(() => expect(predictCalls).toHaveLength(1))
    expect(predictCalls[0].symptoms).toEqual(['fever'])

    // Malaria is one of the curated-followup conditions; answering "Yes" calls
    // setSelected(next) and predicts in the same handler, where `selected` is
    // still the previous render's value. Passing the symptoms as the mutation's
    // variables is what makes the second request include the new one.
    await user.click(
      (await screen.findAllByRole('button', { name: /Yes/i }))[0],
    )
    await waitFor(() => expect(predictCalls).toHaveLength(2))
    expect(predictCalls[1].symptoms).toContain('fever')
    expect(predictCalls[1].symptoms.length).toBe(2)
  })

  it('records a successful prediction in local history', async () => {
    const user = userEvent.setup()
    await predictFor(user, 'fever')

    // The mutation's onSuccess writes to localStorage and re-reads it; drop it
    // and the page still renders results, so nothing else would notice.
    expect(await screen.findByText('Recent checks')).toBeInTheDocument()
    const saved = JSON.parse(localStorage.getItem('medisense-predictions'))
    expect(saved[0]).toMatchObject({ topDisease: 'Malaria', confidence: 97.3 })
  })

  it('saves nothing when the model refuses to rank', async () => {
    const user = userEvent.setup()
    response = REFUSAL
    await predictFor(user, 'fever')

    await screen.findByText(/single symptom cannot distinguish/i)
    expect(screen.queryByText('Recent checks')).not.toBeInTheDocument()
    expect(localStorage.getItem('medisense-predictions')).toBeNull()
  })
})
