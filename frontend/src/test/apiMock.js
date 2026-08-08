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

/**
 * IMPORTANT — how mock state actually behaves here, measured on Vitest 4.1.10
 * with `restoreMocks: true` (vite.config.js) and the `vi.clearAllMocks()` in
 * `test/setup.js`:
 *
 * | thing                    | between tests                        |
 * |--------------------------|--------------------------------------|
 * | `vi.spyOn` spy           | restored — reinstall inside each test |
 * | `vi.fn` implementation   | **kept** — it leaks forward          |
 * | call history             | cleared                              |
 *
 * `restoreMocks` restores spies, not plain mocks, so the danger is the
 * opposite of a reset: an implementation installed anywhere — a `vi.mock`
 * factory, or one test's `mockRejectedValue` — is still in force for every
 * later test in the file. One test's error case then silently becomes the next
 * test's baseline, and assertions keep passing while measuring the wrong thing.
 *
 * So: install per-test behaviour in `beforeEach`, never in the factory, so
 * every test starts from a known implementation rather than inheriting one.
 * `routeGet` and `routePost` exist to make that easy. `apiMockContract.test.js`
 * pins this behaviour, so a Vitest upgrade that changes it fails there loudly
 * instead of quietly greening a page test.
 */
function route(verb, routes, fallback) {
  verb.mockImplementation(async (url, ...rest) => {
    for (const [fragment, respond] of Object.entries(routes)) {
      if (url.includes(fragment)) return { data: respond(url, ...rest) }
    }
    return { data: fallback() }
  })
}

/**
 * Install a URL-routing GET implementation. Call inside `beforeEach`.
 * `routes` maps a URL substring to a responder returning the response body,
 * called as `(url, config)`.
 */
export function routeGet(API, routes, fallback = LIST_SHAPE) {
  route(API.get, routes, fallback)
}

/**
 * The same for writes — the responder is called as `(url, payload, config)`,
 * so a fake server can mutate its state and let the next GET observe it.
 */
export function routePost(API, routes, fallback = LIST_SHAPE) {
  route(API.post, routes, fallback)
}

/**
 * Drop-in replacement for the `shared/api/client` module.
 *
 * Each verb gets its **own** `vi.fn`, deliberately built from a factory rather
 * than from one shared mock. `vi.fn(someOtherMock)` does not wrap a mock, it
 * returns that same mock — so the obvious spelling, `get: vi.fn(respond)` for
 * every verb, made `API`, `API.get` and `API.post` literally the same object.
 * One implementation and one call log between them: installing a `post`
 * behaviour silently replaced what `get` returned, and
 * `expect(API.post).toHaveBeenCalled()` was satisfied by any GET.
 */
export function buildClientMock() {
  const respond = () => vi.fn(async () => ({ data: LIST_SHAPE() }))

  // axios instances are callable as well as having verb methods.
  const API = Object.assign(respond(), {
    get: respond(),
    post: respond(),
    put: respond(),
    patch: respond(),
    delete: respond(),
    // The `*Url` helpers read this to build absolute links.
    defaults: { baseURL: 'http://api.test' },
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
  })

  return { API, OCR_TIMEOUT: 300_000 }
}
