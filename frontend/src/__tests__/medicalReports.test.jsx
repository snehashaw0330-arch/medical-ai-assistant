import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { buildClientMock, routeGet } from '@/test/apiMock'
import { renderRoute, waitForRoute } from '@/test/renderRoute'
import { API } from '@/shared/api/client'

/**
 * The reports list: debounced filters, pagination, a detail modal and a delete.
 *
 * The filter boxes are debounced into separate applied values, and the query is
 * keyed on the applied ones. That is two chances to get it wrong — key it on
 * the box and every keystroke is a request; forget to reset the page and a
 * search from page 3 returns page 3 of the new result set, which usually means
 * an empty screen for a search that matched plenty.
 */

vi.mock('@/shared/api/client', () => buildClientMock())

const report = (id, extra = {}) => ({
  id,
  filename: `${id}.pdf`,
  created_at: '2026-08-01T09:00:00Z',
  medicine_count: 2,
  overall_confidence: 0.9,
  risk_level: 'low',
  ...extra,
})

let reports = []
let listCalls = []

beforeEach(() => {
  reports = [report('alpha'), report('beta', { patient_name: 'Asha Rao' })]
  listCalls = []

  routeGet(API, {
    '/reports/stats': () => ({ total_reports: reports.length, reports_today: 1, average_confidence: 0.9, high_risk_reports: 0 }),
    // `/reports/<id>` — the detail, matched before the list below it.
    '/reports/': (url) => {
      const id = url.split('/reports/')[1]
      return { id, created_at: '2026-08-01T09:00:00Z', content: { filename: `${id}.pdf` } }
    },
    '/reports': (_url, config) => {
      const params = config?.params ?? {}
      listCalls.push(params)
      const matched = params.q
        ? reports.filter((r) => r.filename.includes(params.q))
        : reports
      return { items: matched, total: matched.length, page: params.page ?? 1, pages: 1 }
    },
  })

  API.delete.mockImplementation(async (url) => {
    const id = url.split('/reports/')[1]
    reports = reports.filter((r) => r.id !== id)
    return { data: { status: 'ok' } }
  })
})

describe('medical reports', () => {
  it('waits for the debounce instead of searching per keystroke', async () => {
    const user = userEvent.setup()
    renderRoute('/intake/reports')
    await waitForRoute()
    await waitFor(() => expect(listCalls).toHaveLength(1))

    const main = within(screen.getByRole('main'))
    await user.type(main.getByPlaceholderText(/Search/i), 'alpha')

    // Five keystrokes, one request — after the debounce, not during it.
    await waitFor(() => expect(listCalls).toHaveLength(2), { timeout: 2000 })
    expect(listCalls[1].q).toBe('alpha')
    expect(await screen.findByText('alpha.pdf')).toBeInTheDocument()
    expect(screen.queryByText('beta.pdf')).not.toBeInTheDocument()
  })

  it('opens a report in the viewer', async () => {
    const user = userEvent.setup()
    renderRoute('/intake/reports')
    await waitForRoute()

    // One per row; the first row is `alpha`.
    const [firstView] = await screen.findAllByRole('button', { name: /View report/i })
    await user.click(firstView)

    // The modal's buttons carry visible text ("PDF"); the row's are icon-only
    // with aria-labels ("Download PDF"), so this name is unique to the viewer.
    const pdfButton = await screen.findByRole('button', { name: /^PDF$/ })
    expect(pdfButton).toBeInTheDocument()
    expect(screen.getAllByText('alpha.pdf').length).toBeGreaterThan(1)

    // Close it again — scoped to the modal's own action row, since the sidebar
    // has a "Close" control of its own.
    await user.click(within(pdfButton.parentElement).getByRole('button', { name: /Close/i }))
    await waitFor(() => expect(screen.queryByRole('button', { name: /^PDF$/ })).not.toBeInTheDocument())
  })

  it('refreshes the list and the counters after a delete', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderRoute('/intake/reports')
    await waitForRoute()
    await screen.findByText('alpha.pdf')

    const rows = screen.getAllByRole('button', { name: /^Delete$/i })
    await user.click(rows[0])

    // Deleting invalidates the whole reports domain: the row goes, and the
    // "Total Reports" counter beside it has to follow.
    await waitFor(() => expect(screen.queryByText('alpha.pdf')).not.toBeInTheDocument())
    const totals = within(screen.getByRole('main')).getByText('Total Reports').closest('div')
    expect(within(totals).getByText('1')).toBeInTheDocument()
  })

  it('does not fetch a report before one is opened', async () => {
    renderRoute('/intake/reports')
    await waitForRoute()
    await screen.findByText('alpha.pdf')

    // `enabled` again: without it this requests `/reports/` — with an empty id
    // — on every mount, which is exactly the URL a naive `/reports/<id>` regex
    // fails to match, so this filters by prefix instead.
    const detailCalls = API.get.mock.calls.filter(
      ([url]) => url.startsWith('/reports/') && !url.includes('stats'),
    )
    expect(detailCalls).toHaveLength(0)
  })
})
