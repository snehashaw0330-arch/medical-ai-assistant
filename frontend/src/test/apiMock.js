import { vi } from 'vitest'

/**
 * Fake the network, not the API layer.
 *
 * The mock replaces the shared axios instance in `shared/api/client.js`, so all
 * 23 domain modules run their real code — URL building, param cleaning, response
 * unwrapping — and simply never reach a server.
 *
 * The alternative, mocking `@/lib/api`, was import-path dependent: the first
 * page to import `@/shared/api/history` directly would have quietly escaped the
 * mock and started making real requests inside the test run. Mocking one axios
 * instance cannot be bypassed that way.
 */

// A generic envelope carrying every list key a response might be unwrapped
// into, all empty. Domain modules do `data.medicines ?? []`, so this satisfies
// them without enumerating 93 endpoints.
//
// Returned as an *empty array with these keys attached*, because the backend
// mixes both response shapes: `/history` returns an object to destructure while
// `/digital-twin/patients` is declared `response_model=list[...]` and returns a
// bare array the page calls `.map` on. One value that answers to both means the
// mock never has to know which endpoint is which.
const ENVELOPE = () => ({
  items: [],
  results: [],
  history: [],
  records: [],
  entries: [],
  logs: [],
  medicines: [],
  symptoms: [],
  suggestions: [],
  sources: [],
  citations: [],
  warnings: [],
  models: [],
  datasets: [],
  patients: [],
  runs: [],
  agents: [],
  reports: [],
  documents: [],
  predictions: [],
  recommendations: [],
  interactions: [],
  traces: [],
  stages: [],
  messages: [],
  total: 0,
  count: 0,
  status: 'ok',
})

export const LIST_SHAPE = () => Object.assign([], ENVELOPE())

/** Drop-in replacement for the `shared/api/client` module. */
export function buildClientMock() {
  const respond = vi.fn(async () => ({ data: LIST_SHAPE() }))

  // axios instances are callable as well as having verb methods.
  const API = Object.assign(vi.fn(respond), {
    get: vi.fn(respond),
    post: vi.fn(respond),
    put: vi.fn(respond),
    patch: vi.fn(respond),
    delete: vi.fn(respond),
    // The `*Url` helpers read this to build absolute links.
    defaults: { baseURL: 'http://api.test' },
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
  })

  return { API, OCR_TIMEOUT: 300_000 }
}
