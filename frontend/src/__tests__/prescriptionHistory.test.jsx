import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { buildClientMock, routeGet } from '@/test/apiMock'
import { renderRoute, waitForRoute } from '@/test/renderRoute'
import { API } from '@/shared/api/client'

/**
 * The history list. Same debounced-filter shape as the reports page, plus two
 * things it does not have: a clear-everything button, and downloads that need
 * the *full* record rather than the list row.
 *
 * That last one used to be hand-cached — `detail?.id === id ? detail : fetch` —
 * which only reused the record that happened to be open. It goes through the
 * query cache now, so exporting the record you are looking at makes no request
 * at all. Both halves of that are asserted, because "it still works" and "it
 * stopped re-fetching" are different claims.
 */

vi.mock('@/shared/api/client', () => buildClientMock())

const row = (id) => ({
  id,
  filename: `${id}.png`,
  created_at: '2026-08-01T09:00:00Z',
  medicine_count: 1,
  confidence: 0.9,
  status: 'completed',
  engine: 'gemini',
  processing_time: 3,
  medicine_names: ['Dolo 650'],
})

let records = []
let listCalls = []
let itemGets = []

beforeEach(() => {
  records = [row('alpha'), row('beta')]
  listCalls = []
  itemGets = []

  routeGet(API, {
    '/history/stats': () => ({
      total_analyses: records.length,
      successful_analyses: records.length,
      failed_analyses: 0,
      average_confidence: 0.9,
      average_processing_time: 3,
    }),
    '/history/medicines': () => ['Dolo 650'],
    '/history/': (url) => {
      const id = url.split('/history/')[1]
      itemGets.push(id)
      return { ...row(id), medicines: [{ name: 'Dolo 650', confidence: 0.9 }], fields: {}, has_image: false }
    },
    '/history': (_url, config) => {
      const params = config?.params ?? {}
      listCalls.push(params)
      const matched = params.q ? records.filter((r) => r.filename.includes(params.q)) : records
      return { items: matched, total: matched.length, page: params.page ?? 1, pages: 1 }
    },
  })

  API.delete.mockImplementation(async (url) => {
    if (url.endsWith('/history')) {
      records = []
      return { data: { message: 'History cleared', deleted: 2 } }
    }
    const id = url.split('/history/')[1]
    records = records.filter((r) => r.id !== id)
    return { data: { status: 'ok' } }
  })
})

describe('prescription history', () => {
  it('waits for the debounce instead of searching per keystroke', async () => {
    const user = userEvent.setup()
    renderRoute('/intake/history')
    await waitForRoute()
    await waitFor(() => expect(listCalls).toHaveLength(1))

    const main = within(screen.getByRole('main'))
    await user.type(main.getByPlaceholderText(/Search/i), 'alpha')

    await waitFor(() => expect(listCalls).toHaveLength(2), { timeout: 2000 })
    expect(listCalls[1].q).toBe('alpha')
    expect(await screen.findByText('alpha.png')).toBeInTheDocument()
    expect(screen.queryByText('beta.png')).not.toBeInTheDocument()
  })

  it('does not re-fetch a record it already has open', async () => {
    const user = userEvent.setup()
    renderRoute('/intake/history', { queryOptions: { staleTime: 60_000 } })
    await waitForRoute()
    await screen.findByText('alpha.png')

    const [firstView] = await screen.findAllByRole('button', { name: /View report/i })
    await user.click(firstView)
    await waitFor(() => expect(itemGets).toEqual(['alpha']))

    // Exporting the open record reads the cache the detail query filled.
    const [firstJson] = screen.getAllByRole('button', { name: /Download JSON/i })
    await user.click(firstJson)
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(itemGets).toEqual(['alpha'])
  })

  it('fetches the full record when exporting one that is not open', async () => {
    const user = userEvent.setup()
    renderRoute('/intake/history')
    await waitForRoute()
    await screen.findByText('beta.png')

    const jsonButtons = screen.getAllByRole('button', { name: /Download JSON/i })
    await user.click(jsonButtons[1])

    // The list row is a summary — a download needs the whole record.
    await waitFor(() => expect(itemGets).toEqual(['beta']))
  })

  it('refreshes the list and the counters after a delete', async () => {
    const user = userEvent.setup()
    renderRoute('/intake/history')
    await waitForRoute()
    await screen.findByText('alpha.png')

    const [firstDelete] = screen.getAllByRole('button', { name: /^Delete$/i })
    await user.click(firstDelete)

    await waitFor(() => expect(screen.queryByText('alpha.png')).not.toBeInTheDocument())
    const totals = within(screen.getByRole('main')).getByText(/Total Analyses/i).closest('div')
    expect(within(totals).getByText('1')).toBeInTheDocument()
  })

  it('clears the whole history behind a confirm', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderRoute('/intake/history')
    await waitForRoute()
    await screen.findByText('alpha.png')

    const main = within(screen.getByRole('main'))
    await user.click(main.getByRole('button', { name: /Clear all/i }))
    // Declining the confirm must not delete anything.
    expect(API.delete).not.toHaveBeenCalled()

    confirm.mockReturnValue(true)
    await user.click(main.getByRole('button', { name: /Clear all/i }))
    await waitFor(() => expect(screen.queryByText('alpha.png')).not.toBeInTheDocument())
  })

  it('does not fetch a record before one is opened', async () => {
    renderRoute('/intake/history')
    await waitForRoute()
    await screen.findByText('alpha.png')

    // An ungated detail query would request `/history/` with an empty id.
    expect(itemGets).toEqual([])
  })
})
