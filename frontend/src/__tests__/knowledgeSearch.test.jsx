import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { buildClientMock, routeGet, routePost } from '@/test/apiMock'
import { renderRoute, waitForRoute } from '@/test/renderRoute'
import { API } from '@/shared/api/client'

/**
 * The two Knowledge › Medicines tabs, which are the template for every
 * remaining search page.
 *
 * A search box is the one place where migrating to a query can silently make
 * things much worse: key the query on the input and every keystroke is a
 * request. "Augmentin" is nine lookups, the last one wins, and the page looks
 * completely normal while doing it. So the split between the draft input and
 * the applied term is asserted directly, by typing and counting.
 */

vi.mock('@/shared/api/client', () => buildClientMock())

const DOLO = {
  medicine: 'dolo 650',
  uses: ['Fever', 'Mild pain'],
  side_effects: ['Nausea'],
  therapeutic_class: 'Analgesic',
  match_score: 98,
}

let lookups = []
let reports = []
let recommendationGets = 0
let reportGets = []

beforeEach(() => {
  lookups = []
  reports = [{ id: 'rec-1', medicines: ['aspirin'], created_at: '2026-08-01T10:00:00Z' }]
  recommendationGets = 0
  reportGets = []

  routeGet(API, {
    '/medicine-info/': (url) => {
      const name = decodeURIComponent(url.split('/medicine-info/')[1] || '')
      lookups.push(name)
      if (name.toLowerCase() === 'dolo 650') return DOLO
      return { error: 'not found', suggestions: ['Dolo 650'] }
    },
    // The detail route is a prefix of the list route, so it is matched first.
    '/medicine/recommendations/': (url) => {
      const id = url.split('/medicine/recommendations/')[1]
      reportGets.push(id)
      return { id, medicines: [{ detected_name: `storedreport${id.replace('-', '')}`, drug_info: {}, confidence_score: 90 }] }
    },
    '/medicine/recommendations': () => {
      recommendationGets += 1
      return { items: [...reports], total: reports.length }
    },
  })

  routePost(API, {
    '/medicine/recommend': (_url, payload) => {
      const report = { id: 'rec-2', medicines: payload.medicines, created_at: '2026-08-05T10:00:00Z' }
      reports = [report, ...reports]
      return {
        id: 'rec-2',
        medicines: payload.medicines.map((m) => ({
          detected_name: m,
          matched: true,
          confidence_score: 88,
          drug_info: {},
        })),
      }
    },
  })
})

describe('medicine search', () => {
  it('does not look anything up while the box is being typed into', async () => {
    const user = userEvent.setup()
    renderRoute('/knowledge/medicines')
    await waitForRoute()

    const box = screen.getByPlaceholderText(/Search a medicine/i)
    await user.type(box, 'Dolo 650')
    expect(lookups).toEqual([])

    await user.click(screen.getByRole('button', { name: /^Search$/i }))
    await waitFor(() => expect(lookups).toEqual(['Dolo 650']))
    expect(await screen.findByText(/Analgesic/)).toBeInTheDocument()
  })

  it('serves a repeated search from cache', async () => {
    const user = userEvent.setup()
    renderRoute('/knowledge/medicines', { queryOptions: { staleTime: 60_000 } })
    await waitForRoute()

    await user.click(screen.getByRole('button', { name: /Dolo 650/ }))
    await waitFor(() => expect(lookups).toEqual(['Dolo 650']))
    await screen.findByText(/Analgesic/)

    // Search the same term again — the point of the cache.
    await user.click(screen.getByRole('button', { name: /^Search$/i }))
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(lookups).toEqual(['Dolo 650'])
  })

  it('offers the suggestion for a miss, and searching it works', async () => {
    const user = userEvent.setup()
    renderRoute('/knowledge/medicines')
    await waitForRoute()

    await user.type(screen.getByPlaceholderText(/Search a medicine/i), 'dolo6500')
    await user.click(screen.getByRole('button', { name: /^Search$/i }))

    // A miss is a 200 carrying `error`, not a thrown request.
    expect(await screen.findByText(/Medicine not found/i)).toBeInTheDocument()

    // Scoped to the not-found card: "Dolo 650" is also one of the popular
    // chips above, so an unscoped query matches two buttons.
    const suggestions = within(screen.getByText(/Did you mean/i).parentElement)
    await user.click(suggestions.getByRole('button', { name: /^Dolo 650$/i }))
    expect(await screen.findByText(/Analgesic/)).toBeInTheDocument()
    expect(lookups).toEqual(['dolo6500', 'Dolo 650'])
  })
})

describe('medicine recommendations', () => {
  it('refreshes the recent list after generating a report', async () => {
    const user = userEvent.setup()
    renderRoute('/knowledge/medicines/alternatives')
    await waitForRoute()
    await waitFor(() => expect(recommendationGets).toBe(1))

    const tags = screen.getByPlaceholderText(/medicine/i)
    await user.type(tags, 'ibuprofen{Enter}')
    await user.click(screen.getByRole('button', { name: /Get Recommendations/i }))

    expect(await screen.findByRole('heading', { name: /Ibuprofen/i })).toBeInTheDocument()
    // Persisting a report makes the recent list stale; without invalidation it
    // keeps showing yesterday's runs until a reload.
    await waitFor(() => expect(recommendationGets).toBe(2))
  })

  it('shows no report until one is generated or opened', async () => {
    renderRoute('/knowledge/medicines/alternatives')
    await waitForRoute()
    await waitFor(() => expect(recommendationGets).toBe(1))

    // Without `enabled`, the detail query runs with an empty id on mount —
    // `GET /medicine/recommendations/` — and this page renders whatever comes
    // back as if the user had asked for it.
    expect(reportGets).toEqual([])
    expect(screen.queryByRole('heading', { name: /Storedreport/i })).not.toBeInTheDocument()
  })

  it('opens a stored report from the recent list', async () => {
    const user = userEvent.setup()
    renderRoute('/knowledge/medicines/alternatives')
    await waitForRoute()

    const main = within(screen.getByRole('main'))
    await user.click(await main.findByRole('button', { name: /aspirin/i }))

    expect(await screen.findByRole('heading', { name: /Storedreportrec1/i })).toBeInTheDocument()
  })
})
