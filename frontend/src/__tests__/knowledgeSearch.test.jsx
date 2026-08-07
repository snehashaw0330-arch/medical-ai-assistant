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
let ragQueries = []
let ragChunks = 7

beforeEach(() => {
  lookups = []
  reports = [{ id: 'rec-1', medicines: ['aspirin'], created_at: '2026-08-01T10:00:00Z' }]
  recommendationGets = 0
  reportGets = []
  ragQueries = []
  ragChunks = 7

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
    '/rag/status': () => ({
      available: true,
      vector_backend: 'chroma',
      embedding_model: 'MiniLM',
      llm_provider: 'offline',
      indexed_chunks: ragChunks,
      documents: [{ name: 'bnf.pdf' }],
    }),
    '/medicine/recommendations': () => {
      recommendationGets += 1
      return { items: [...reports], total: reports.length }
    },
  })

  routePost(API, {
    '/rag/query': (_url, payload) => {
      ragQueries.push(payload.question)
      return { answer: 'Aspirin thins the blood.', chunks: [], llm_provider: 'offline' }
    },
    '/rag/index': () => ({ indexed_chunks: ragChunks, documents: 1 }),
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

/**
 * The Knowledge Base is the one migrated page that reports failures in its own
 * banner instead of a toast, via `toastErrors: false` on all four of its calls.
 * That is worth pinning: the default is the opposite, and a page that quietly
 * starts double-reporting — banner *and* toast, saying the same thing twice —
 * is the kind of regression nobody files a bug about.
 */
describe('knowledge base', () => {
  it('does not search while the question is being typed', async () => {
    const user = userEvent.setup()
    renderRoute('/knowledge/base')
    await waitForRoute()

    await user.type(screen.getByPlaceholderText(/Ask the knowledge base/i), 'side effects of aspirin')
    expect(ragQueries).toEqual([])

    const main = within(screen.getByRole('main'))
    await user.click(main.getByRole('button', { name: /Search/i }))
    await waitFor(() => expect(ragQueries).toEqual(['side effects of aspirin']))
    expect(await screen.findByText(/Aspirin thins the blood/)).toBeInTheDocument()
  })

  it('refreshes the status panel after rebuilding the index', async () => {
    const user = userEvent.setup()
    renderRoute('/knowledge/base')
    await waitForRoute()
    expect(await screen.findByText('7')).toBeInTheDocument()

    ragChunks = 42
    await user.click(screen.getByRole('button', { name: /Rebuild Index/i }))

    // The index rebuild changes the numbers this panel is showing.
    expect(await screen.findByText('42')).toBeInTheDocument()
  })

  it('reports a failed rebuild once, in the banner', async () => {
    const user = userEvent.setup()
    renderRoute('/knowledge/base')
    await waitForRoute()
    await screen.findByText('7')

    API.post.mockRejectedValue(new Error('chromadb is not installed'))
    await user.click(screen.getByRole('button', { name: /Rebuild Index/i }))

    // Exactly one: a toast on top of the banner would make this two.
    await waitFor(() => expect(screen.getAllByText(/chromadb is not installed/)).toHaveLength(1))
  })
})
