import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { buildClientMock, routeGet, routePost } from '@/test/apiMock'
import { renderRoute, waitForRoute } from '@/test/renderRoute'
import { API } from '@/shared/api/client'

/**
 * Does a write actually refresh what it changed?
 *
 * This is the one behaviour `useApiMutation` adds that a page cannot fake by
 * looking right: `invalidates` replaced the hand-rolled `await load()` every
 * page used to run after a POST. Delete it and nothing throws, nothing logs,
 * and the only symptom is a list quietly showing pre-write data until the user
 * reloads the browser.
 *
 * The assertions are therefore end-to-end and stateful: a fake server holds a
 * mutable list, the POST appends to it, and the test asserts the new row
 * *appears on screen* with no further interaction. Nothing but a refetch can
 * put it there — closing the modal does not remount the list query.
 *
 * An earlier attempt at this test passed with invalidation deleted from both
 * the hook and the page. The cause was in the harness, not the page: every verb
 * on the client mock was literally the same mock object, so installing a POST
 * implementation replaced the GET one and the list query stopped returning the
 * fake server's list. (The cause recorded at the time — `restoreMocks`
 * discarding implementations between tests — turned out not to be real; see
 * the table in `test/apiMock.js` for what that setting does do.) The sharing is
 * fixed in `test/apiMock.js` and pinned by `apiMockContract.test.js`.
 *
 * Behaviour is installed in `beforeEach` regardless, so no test inherits the
 * implementation another one left behind.
 */

vi.mock('@/shared/api/client', () => buildClientMock())

// The fake server's state, rebuilt per test.
let models = []
let datasets = []
let modelListFetches = 0
let datasetListFetches = 0

beforeEach(() => {
  models = [{ name: 'triage-net', version: '1.0.0', status: 'production', accuracy: 0.91 }]
  datasets = [{ name: 'rx-scans', version: '2024.1', source: 'internal' }]
  modelListFetches = 0
  datasetListFetches = 0

  routeGet(API, {
    '/governance/models': () => {
      modelListFetches += 1
      return [...models]
    },
    '/governance/datasets': () => {
      datasetListFetches += 1
      return [...datasets]
    },
  })

  routePost(API, {
    '/governance/models': (_url, payload) => {
      models.push({ ...payload })
      return { status: 'ok' }
    },
    '/governance/datasets': (_url, payload) => {
      datasets.push({ ...payload })
      return { status: 'ok' }
    },
  })
})

/** Fill the two required fields of a register modal and save. */
async function register(user, { name, version }) {
  await user.type(screen.getByLabelText(/^Name \*/), name)
  await user.type(screen.getByLabelText(/^Version \*/), version)
  await user.click(screen.getByRole('button', { name: /Save/i }))
}

describe('a write refreshes the data it changed', () => {
  it('shows a newly registered model without a reload', async () => {
    const user = userEvent.setup()
    renderRoute('/governance/models')
    await waitForRoute()

    expect(await screen.findByText('triage-net')).toBeInTheDocument()
    expect(screen.queryByText('ocr-vlm')).not.toBeInTheDocument()
    expect(modelListFetches).toBe(1)

    await user.click(screen.getByRole('button', { name: /Register model/i }))
    await register(user, { name: 'ocr-vlm', version: '3.1.0' })

    // Only an invalidation-driven refetch can put this on screen.
    expect(await screen.findByText('ocr-vlm')).toBeInTheDocument()
    expect(modelListFetches).toBe(2)
    expect(API.post).toHaveBeenCalledWith(
      '/governance/models',
      expect.objectContaining({ name: 'ocr-vlm', version: '3.1.0' }),
    )
  })

  it('shows a newly registered dataset without a reload', async () => {
    const user = userEvent.setup()
    renderRoute('/governance/datasets')
    await waitForRoute()

    expect(await screen.findByText('rx-scans')).toBeInTheDocument()
    expect(datasetListFetches).toBe(1)

    await user.click(screen.getByRole('button', { name: /Register dataset/i }))
    await register(user, { name: 'handwritten-v2', version: '2026.08' })

    expect(await screen.findByText('handwritten-v2')).toBeInTheDocument()
    expect(datasetListFetches).toBe(2)
  })

  it('leaves the list alone when the write is rejected', async () => {
    const user = userEvent.setup()
    API.post.mockRejectedValue(new Error('Network Error'))
    renderRoute('/governance/models')
    await waitForRoute()
    await screen.findByText('triage-net')

    await user.click(screen.getByRole('button', { name: /Register model/i }))
    await register(user, { name: 'ocr-vlm', version: '3.1.0' })

    // A failed write must not invalidate. The error toast is the user-visible
    // proof the mutation resolved before the refetch count is read.
    expect(await screen.findByText(/Could not register model|Network Error/i)).toBeInTheDocument()
    await waitFor(() => expect(modelListFetches).toBe(1))
    expect(screen.queryByText('ocr-vlm')).not.toBeInTheDocument()
  })
})
