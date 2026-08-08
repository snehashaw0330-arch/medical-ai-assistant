import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LIST_SHAPE, buildClientMock } from '@/test/apiMock'
import { renderRoute, waitForRoute } from '@/test/renderRoute'

/**
 * The backend refuses to rank when it has no signal, and explains why. These
 * pin that the explanation actually reaches the user.
 *
 * Worth testing at this level rather than trusting the backend tests: the page
 * previously replaced the backend's specific reason with generic advice ("try
 * rephrasing"), which is the *wrong* instruction when what is needed is another
 * symptom — and it did so silently, because an empty prediction list looks the
 * same either way.
 */
const REFUSAL = {
  predictions: [],
  resolved_symptoms: [],
  unmatched_inputs: [],
  suggested_symptoms: [],
  confidence_level: 'low',
  warnings: [
    'No assessment produced. A single symptom cannot distinguish between 41 conditions. Add at least one more.',
  ],
  disclaimer: 'This is an AI triage aid, not a medical diagnosis.',
}

vi.mock('@/shared/api/client', () => {
  const mock = buildClientMock()
  const { API } = mock
  API.post.mockImplementation(async (url) =>
    url.includes('/disease/predict')
      ? { data: REFUSAL }
      : { data: LIST_SHAPE() },
  )
  return mock
})

describe('disease prediction refuses honestly', () => {
  it('shows the backend reason instead of generic advice', async () => {
    const user = userEvent.setup()
    renderRoute('/clinical/disease')
    await waitForRoute()

    // TagInput renders role="combobox", not a plain textbox.
    await user.type(screen.getByRole('combobox'), 'headache{Enter}')
    await user.click(screen.getByRole('button', { name: /Check Symptoms/i }))

    // The specific reason, not "Try rephrasing…".
    expect(
      await screen.findByText(/single symptom cannot distinguish/i),
    ).toBeInTheDocument()

    // And it must not claim the model looked and found nothing.
    expect(screen.queryByText('No conditions matched')).not.toBeInTheDocument()
  })
})
