import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { buildClientMock, routeGet, routePost } from '@/test/apiMock'
import { renderRoute, waitForRoute } from '@/test/renderRoute'
import { API } from '@/shared/api/client'

/**
 * The Agent Monitor's two polling behaviours.
 *
 * A `refetchInterval` that never stops is a request every 1.2 seconds for as
 * long as the tab is open, and the page looks perfectly healthy while doing it
 * — the run card just sits there saying "Completed". That is the failure this
 * file exists to catch, so the stop condition is asserted directly: after the
 * run reports a terminal status, the request count must not move again.
 *
 * This test uses real timers and therefore takes a few seconds. Fake timers
 * would be faster but they stall RTL's `waitFor`, which detects fake timers via
 * a `jest` global this project does not have (`globals: false`). Real time it
 * is; it buys a test that watches the actual polling loop.
 */

vi.mock('@/shared/api/client', () => buildClientMock())

const RUN_POLL_MS = 1_200
const EVAL_POLL_MS = 2_000

let runStatus = 'running'
let runGets = []
let healthProbes = []
let jobStatus = 'running'
let jobGets = []

const jobBody = () => ({
  job_id: 'job-1',
  status: jobStatus,
  total: 4,
  processed: jobStatus === 'completed' ? 4 : 1,
  failed: 0,
  current_image: 'scan-1.jpg',
  error: jobStatus === 'failed' ? 'The dataset directory is empty' : null,
  report:
    jobStatus === 'completed'
      ? { metrics: { total_images: 4, processed_images: 4, failed_images: 0, average_confidence: 0.8, medicine_detection_rate: 0.75, average_processing_time: 3.2, total_medicines_extracted: 9 }, results: [] }
      : null,
})

const runBody = () => ({
  run_id: 'run-1',
  status: runStatus,
  progress: runStatus === 'completed' ? 1 : 0.5,
  completed_agents: runStatus === 'completed' ? 2 : 1,
  total_agents: 2,
  agents: [],
})

beforeEach(() => {
  runStatus = 'running'
  runGets = []
  healthProbes = []
  jobStatus = 'running'
  jobGets = []

  routeGet(API, {
    '/ocr/evaluate-dataset/status/': () => {
      jobGets.push(jobStatus)
      return jobBody()
    },
    '/ocr/dataset-info': () => ({ image_count: 4, dataset: 'datasets/prescriptions', exists: true }),
    // `/agents/runs/<id>` before the `/agents/runs` list it is prefixed by.
    '/agents/runs/': () => {
      runGets.push(runStatus)
      return runBody()
    },
    '/agents/runs': () => [],
    '/agents/health': (_url, config) => {
      healthProbes.push(Boolean(config?.params?.force))
      return { status: 'ok', healthy_agents: 2, total_agents: 2, llm_provider: 'offline', agents: [] }
    },
    '/agents/registry': () => ({ agents: [], llm_provider: 'offline' }),
  })

  routePost(API, {
    '/agents/run': () => ({ run_id: 'run-1', status: 'pending', task_type: 'full' }),
    '/ocr/evaluate-dataset': () => ({ job_id: 'job-1', status: 'running', total: 4, processed: 0, failed: 0, current_image: 'scan-1.jpg' }),
  })
})

/** Type a note and launch — the cheapest valid way to start a run. */
async function launch(user) {
  await user.type(screen.getByPlaceholderText(/Free-text context/i), 'headache since monday')
  await user.click(screen.getByRole('button', { name: /Run Multi-Agent Pipeline/i }))
}

describe('agent run polling', () => {
  it('polls a live run and stops once it reaches a terminal status', async () => {
    const user = userEvent.setup()
    renderRoute('/governance/agents')
    await waitForRoute()

    await launch(user)

    // Polling is happening at all.
    await waitFor(() => expect(runGets.length).toBeGreaterThanOrEqual(2), { timeout: 4000 })
    expect(await screen.findByText(/Running/)).toBeInTheDocument()

    runStatus = 'completed'
    await waitFor(() => expect(runGets).toContain('completed'), { timeout: 4000 })
    const afterCompletion = runGets.length

    // And now the important half: it has to stop. Two intervals of grace, so a
    // still-running poller is unambiguous rather than a race.
    await new Promise((resolve) => setTimeout(resolve, RUN_POLL_MS * 2))
    expect(runGets.length).toBe(afterCompletion)
  }, 20_000)

  it('does not poll a run before one is started', async () => {
    renderRoute('/governance/agents')
    await waitForRoute()
    await new Promise((resolve) => setTimeout(resolve, RUN_POLL_MS + 300))

    // `enabled: Boolean(runId)` — without it this is a request for
    // `/agents/runs/` every 1.2s from the moment the page opens.
    expect(runGets).toEqual([])
  }, 10_000)
})

describe('dataset evaluation polling', () => {
  it('polls the job while it runs and stops when it completes', async () => {
    const user = userEvent.setup()
    renderRoute('/governance/benchmarks')
    await waitForRoute()

    await user.click(await screen.findByRole('button', { name: /Run Evaluation/i }))

    // The start response seeds the cache, so progress is on screen before the
    // first poll lands rather than after it.
    expect(await screen.findByText(/Processing scan-1/)).toBeInTheDocument()
    await waitFor(() => expect(jobGets.length).toBeGreaterThanOrEqual(1), { timeout: 6000 })

    jobStatus = 'completed'
    expect(await screen.findByText(/Evaluation Complete/i, {}, { timeout: 6000 })).toBeInTheDocument()
    const afterCompletion = jobGets.length

    await new Promise((resolve) => setTimeout(resolve, EVAL_POLL_MS * 2))
    expect(jobGets.length).toBe(afterCompletion)
  }, 25_000)

  it('shows progress from the start response, before the first poll lands', async () => {
    const user = userEvent.setup()
    // A status request that takes a moment, which on a real network it does.
    const routed = API.get.getMockImplementation()
    API.get.mockImplementation(async (url, config) => {
      if (url.includes('/ocr/evaluate-dataset/status/')) {
        await new Promise((resolve) => setTimeout(resolve, 400))
      }
      return routed(url, config)
    })

    renderRoute('/governance/benchmarks')
    await waitForRoute()
    await user.click(await screen.findByRole('button', { name: /Run Evaluation/i }))

    // The mutation has settled and the first poll has not answered yet. The
    // page must already show the job it just started, or the progress bar and
    // the disabled button blink out in the gap.
    expect(screen.getByText(/Processing scan-1/)).toBeInTheDocument()
    expect(jobGets).toEqual([])

    // Drain the slow request before finishing. Left in flight it lands during
    // the *next* test, after `beforeEach` has reset the counters, and shows up
    // there as a phantom extra poll.
    await waitFor(() => expect(jobGets).toEqual(['running']), { timeout: 4000 })
  }, 15_000)

  it('surfaces a failed job as an error instead of polling forever', async () => {
    const user = userEvent.setup()
    jobStatus = 'failed'
    renderRoute('/governance/benchmarks')
    await waitForRoute()

    await user.click(await screen.findByRole('button', { name: /Run Evaluation/i }))

    expect(await screen.findByText(/dataset directory is empty/i, {}, { timeout: 6000 })).toBeInTheDocument()
    const afterFailure = jobGets.length
    await new Promise((resolve) => setTimeout(resolve, EVAL_POLL_MS * 2))
    expect(jobGets.length).toBe(afterFailure)
  }, 25_000)
})

describe('agent health probe', () => {
  it('probes unforced on mount and forced on demand', async () => {
    const user = userEvent.setup()
    renderRoute('/governance/agents')
    await waitForRoute()

    await waitFor(() => expect(healthProbes).toEqual([false]))

    const main = within(screen.getByRole('main'))
    await user.click(main.getByRole('button', { name: /Refresh agent health/i }))

    // `force` is what makes the backend re-contact each agent instead of
    // returning its cached snapshot, so the button must not degrade into a
    // plain refetch of the polling query.
    await waitFor(() => expect(healthProbes).toEqual([false, true]))
  })
})
