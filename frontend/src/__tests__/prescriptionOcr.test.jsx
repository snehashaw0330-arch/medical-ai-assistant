import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { buildClientMock, routePost } from '@/test/apiMock'
import { renderRoute, waitForRoute } from '@/test/renderRoute'
import { API } from '@/shared/api/client'

/**
 * The prescription reader — the page the whole product is built around, and the
 * one the plan deliberately migrated last.
 *
 * Four behaviours here are safety-relevant rather than cosmetic:
 *
 * 1. A low-quality image *gates* rather than silently proceeding. Losing the
 *    gate means bad scans get read as if they were good ones.
 * 2. A failed quality check must never block OCR — it is best-effort.
 * 3. A cancelled scan is a user action, not an error.
 * 4. The backend's auto-chain (interactions, clinical decision, validation) is
 *    shipped inline on the OCR response and has to reach the screen.
 */

vi.mock('@/shared/api/client', () => buildClientMock())

const OCR_RESULT = {
  raw_text: 'Rx Dolo 650',
  provider: 'gemini',
  overall_confidence: 0.91,
  medicines: [{ name: 'Dolo 650', confidence: 0.93, dosage: '650mg', matched: true }],
  fields: { patient_name: 'Asha Rao' },
  drug_interactions: { interactions: [], total: 0, summary: 'Auto-chained interaction check.' },
  clinical_report: { clinical_summary: 'Auto-chained clinical summary.', risk_level: 'low', confidence: 80, risk_score: 15 },
  validation_report: { valid: true, issues: [], summary: 'Auto-chained validation.' },
}

let quality = { passed: true, overall_score: 88, threshold: 60 }
let qualityFails = false

beforeEach(() => {
  quality = { passed: true, overall_score: 88, threshold: 60 }
  qualityFails = false

  routePost(API, {
    '/ocr/image-quality': () => {
      if (qualityFails) throw new Error('quality service down')
      return quality
    },
    '/ocr/extract-prescription': () => OCR_RESULT,
  })
})

const attach = async (user) => {
  const file = new File(['x'], 'rx.png', { type: 'image/png' })
  const [input] = document.querySelectorAll('input[type="file"]')
  await user.upload(input, file)
}

const analyze = async (user) =>
  user.click(within(screen.getByRole('main')).getByRole('button', { name: /^Analyze$/i }))

describe('prescription ocr', () => {
  it('reads a good scan and shows the auto-chained reports', async () => {
    const user = userEvent.setup()
    renderRoute('/intake/prescription')
    await waitForRoute()

    await attach(user)
    await analyze(user)

    expect(await screen.findByText(/Dolo 650/)).toBeInTheDocument()
    // The backend ships all three inline; losing any of them loses a safety
    // check the user never knows was supposed to run.
    expect(await screen.findByText(/Auto-chained interaction check/)).toBeInTheDocument()
    expect(await screen.findByText(/Auto-chained clinical summary/)).toBeInTheDocument()
    expect(await screen.findByText(/Auto-chained validation/)).toBeInTheDocument()
  })

  it('gates a low-quality image instead of scanning it', async () => {
    const user = userEvent.setup()
    quality = { passed: false, overall_score: 31, threshold: 60 }
    renderRoute('/intake/prescription')
    await waitForRoute()

    await attach(user)
    await analyze(user)

    expect(await screen.findByRole('button', { name: /Run OCR anyway/i })).toBeInTheDocument()
    // The scan must not have happened yet.
    expect(API.post.mock.calls.filter(([u]) => u.includes('extract-prescription'))).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: /Run OCR anyway/i }))
    expect(await screen.findByText(/Dolo 650/)).toBeInTheDocument()
  })

  it('scans anyway when the quality check itself fails', async () => {
    const user = userEvent.setup()
    qualityFails = true
    renderRoute('/intake/prescription')
    await waitForRoute()

    await attach(user)
    await analyze(user)

    // Best-effort: a broken quality service must not stop a prescription being
    // read.
    expect(await screen.findByText(/Dolo 650/)).toBeInTheDocument()
  })

  it('treats a cancelled scan as a cancellation, not a failure', async () => {
    const user = userEvent.setup()
    API.post.mockImplementation(
      (url, _form, config) =>
        new Promise((resolve, reject) => {
          if (url.includes('image-quality')) return resolve({ data: quality })
          config?.signal?.addEventListener('abort', () => {
            const err = new Error('canceled')
            err.code = 'ERR_CANCELED'
            err.name = 'CanceledError'
            reject(err)
          })
        }),
    )

    renderRoute('/intake/prescription')
    await waitForRoute()
    await attach(user)
    await analyze(user)

    const [cancel] = await screen.findAllByRole('button', { name: /Cancel/i })
    await user.click(cancel)

    // Assert the banner is gone entirely, not just its fallback wording:
    // `errorMessage` prefers the error's own message, so a regression here
    // renders "Analysis failed / canceled" and a wording-based check sails past
    // it. The heading exists nowhere else on the page.
    await waitFor(() => expect(screen.getByRole('button', { name: /^Analyze$/i })).toBeEnabled())
    expect(screen.queryByText(/Analysis failed/i)).not.toBeInTheDocument()
  })

  it('reports a real failure inline', async () => {
    const user = userEvent.setup()
    renderRoute('/intake/prescription')
    await waitForRoute()
    await attach(user)

    API.post.mockImplementation(async (url) => {
      if (url.includes('image-quality')) return { data: quality }
      throw new Error('OCR engine unavailable')
    })
    await analyze(user)

    expect(await screen.findByText(/Analysis failed/i)).toBeInTheDocument()
    expect(screen.getByText(/OCR engine unavailable/)).toBeInTheDocument()
  })
})
