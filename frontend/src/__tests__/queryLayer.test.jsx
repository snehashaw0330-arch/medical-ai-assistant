import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LIST_SHAPE, buildClientMock } from '@/test/apiMock'
import { renderRoute, waitForRoute } from '@/test/renderRoute'

/**
 * Phase 5 guards.
 *
 * NOTE: mutation-invalidation is deliberately NOT covered here. An attempt at
 * it passed with invalidation removed entirely from both the hook and the page
 * — the request never reached the mock, so the assertion was measuring
 * something else. A test that green-lights a deleted feature is worse than no
 * test, so it was removed rather than left in place. See the commit message. The TanStack migration is mostly mechanical, but two things
 * are easy to get wrong and invisible once wrong:
 *
 * 1. Keying a query on the filter form's draft state refetches on every
 *    keystroke — correct-looking, and a request storm in production.
 * 2. Pagination is rendered only when there is more than one page, so the
 *    route tests never reach it. ESLint caught two dead `load()` calls there
 *    that the whole suite had run straight past.
 */
const PAGE = {
  items: [
    { id: 1, user: 'sys', method: 'GET', api: '/ocr', status_code: 200, processing_time_ms: 12, created_at: '2026-08-02T10:00:00Z' },
  ],
  total: 60,
  page: 1,
  pages: 2,
}

const auditCalls = []

vi.mock('@/shared/api/client', () => {
  const mock = buildClientMock()
  mock.API.get.mockImplementation(async (url, config) => {
    if (url.includes('/governance/audit-logs')) {
      auditCalls.push(config?.params ?? {})
      return { data: { ...PAGE, page: config?.params?.page ?? 1 } }
    }
    return { data: LIST_SHAPE() }
  })
  return mock
})

describe('audit logs query layer', () => {
  it('does not refetch while the filter form is being typed into', async () => {
    const user = userEvent.setup()
    auditCalls.length = 0
    renderRoute('/governance/audit')
    await waitForRoute()
    await waitFor(() => expect(auditCalls.length).toBe(1))

    await user.type(screen.getByPlaceholderText(/ocr, \/governance/i), '/history')
    // Eight keystrokes must not be eight requests.
    expect(auditCalls).toHaveLength(1)

    // Scoped to <main>: the sidebar's Cmd-K trigger is also named "Search".
    const main = within(screen.getByRole('main'))
    await user.click(main.getByRole('button', { name: /Search/i }))
    await waitFor(() => expect(auditCalls.length).toBe(2))
    expect(auditCalls[1].api).toBe('/history')
  })

  it('paginates', async () => {
    const user = userEvent.setup()
    auditCalls.length = 0
    renderRoute('/governance/audit')
    await waitForRoute()
    await waitFor(() => expect(auditCalls.length).toBe(1))

    await user.click(await screen.findByRole('button', { name: /Next/i }))
    await waitFor(() => expect(auditCalls.at(-1).page).toBe(2))
  })
})
