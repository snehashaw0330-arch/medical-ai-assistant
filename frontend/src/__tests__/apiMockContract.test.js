import { describe, expect, it, vi } from 'vitest'
import { buildClientMock, routeGet, routePost } from '@/test/apiMock'

/**
 * The mock every other frontend test is built on, tested itself.
 *
 * `buildClientMock` used to spell each verb `vi.fn(respond)` with one shared
 * `respond` mock. `vi.fn` does not wrap a function that is already a mock — it
 * hands the same mock back — so `API`, `API.get`, `API.post`, `API.put`,
 * `API.patch` and `API.delete` were one object with one implementation and one
 * call log. Two consequences, both silent:
 *
 * * installing a POST implementation replaced what GET returned, so a page's
 *   list fetches started resolving to the write's response;
 * * `expect(API.post).toHaveBeenCalledWith(...)` was satisfied by a GET.
 *
 * A test asserting a write happened could therefore pass with the write gone.
 * These cases exist so that regression announces itself here, in four lines,
 * instead of as a green mutation somewhere in a page test.
 */

const VERBS = ['get', 'post', 'put', 'patch', 'delete']

describe('the api client mock', () => {
  it('gives every verb its own mock', () => {
    const { API } = buildClientMock()
    const fns = [API, ...VERBS.map((v) => API[v])]
    expect(new Set(fns).size).toBe(fns.length)
  })

  it('keeps call logs per verb', async () => {
    const { API } = buildClientMock()
    await API.get('/x')
    expect(API.get).toHaveBeenCalledTimes(1)
    for (const verb of VERBS.filter((v) => v !== 'get')) {
      expect(API[verb], verb).not.toHaveBeenCalled()
    }
  })

  it('routes reads and writes independently', async () => {
    const { API } = buildClientMock()
    routeGet(API, { '/models': () => ['read'] })
    routePost(API, { '/models': () => ['written'] })

    expect((await API.get('/models')).data).toEqual(['read'])
    expect((await API.post('/models', {})).data).toEqual(['written'])
    // Installing the write must not have disturbed the read.
    expect((await API.get('/models')).data).toEqual(['read'])
  })

  it('passes the payload to a write responder', async () => {
    const { API } = buildClientMock()
    routePost(API, { '/models': (_url, payload) => ({ echoed: payload.name }) })
    expect((await API.post('/models', { name: 'ocr-vlm' })).data).toEqual({ echoed: 'ocr-vlm' })
  })

  it('falls back to the empty envelope for unrouted urls', async () => {
    const { API } = buildClientMock()
    routeGet(API, { '/models': () => ['read'] })
    const { data } = await API.get('/something-else')
    expect(data.items).toEqual([])
    expect(Array.isArray(data)).toBe(true)
  })
})

/**
 * Vitest's own between-test behaviour, pinned.
 *
 * Every test file here assumes a particular answer to "what survives into the
 * next test", and the answer was documented backwards for a while: the note in
 * `apiMock.js` claimed `restoreMocks: true` discarded implementations, when in
 * fact it restores `vi.spyOn` spies and leaves `vi.fn` implementations in
 * place. Guidance written against the wrong model is how a test ends up
 * measuring nothing, so the model itself is asserted rather than believed.
 *
 * The pair below is order-dependent on purpose — that is the property under
 * test — which is why it lives at the end of the file.
 */
const leaky = vi.fn(() => 'initial')
const target = { hello: () => 'original' }

describe('mock lifetime between tests', () => {
  it('installs an implementation and a spy', () => {
    leaky.mockReturnValue('overridden')
    vi.spyOn(target, 'hello').mockReturnValue('spied')
    expect(leaky()).toBe('overridden')
    expect(target.hello()).toBe('spied')
  })

  it('keeps the implementation, restores the spy, clears the calls', () => {
    // Install per-test behaviour in `beforeEach` because of this line, not
    // because anything resets it for you.
    expect(leaky()).toBe('overridden')
    expect(target.hello()).toBe('original')
    expect(leaky).toHaveBeenCalledTimes(1)
  })
})
