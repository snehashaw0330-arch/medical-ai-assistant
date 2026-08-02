import { describe, expect, it } from 'vitest'
import * as barrel from '@/lib/api'

/**
 * Guards the API layer's public surface after the split into per-domain modules.
 *
 * The route tests cannot cover this: most pages catch their own fetch errors and
 * show a toast, so a function that silently became `undefined` never reaches an
 * error boundary and every route test stays green. Dropping one
 * `export * from '@/shared/api/<domain>'` line was verified to do exactly that.
 */

// Every domain module, discovered at build time — nothing to keep in sync here.
const modules = import.meta.glob('@/shared/api/*.js', { eager: true })

const domainModules = Object.entries(modules).filter(
  ([path]) => !path.endsWith('/client.js'),
)

describe('api surface', () => {
  it('discovers every domain module', () => {
    expect(domainModules).toHaveLength(23)
  })

  it.each(domainModules.map(([path, mod]) => [path.split('/').pop(), mod]))(
    '%s is fully re-exported from the barrel',
    (_name, mod) => {
      const missing = Object.keys(mod).filter((key) => !(key in barrel))
      expect(missing).toEqual([])
    },
  )

  it('exposes the whole surface with no name collisions', () => {
    const fromDomains = domainModules.flatMap(([, mod]) => Object.keys(mod))
    // `export *` silently drops a name exported by two modules at once.
    expect(new Set(fromDomains).size).toBe(fromDomains.length)

    // 111 callables and constants carried over from the pre-split api.js,
    // plus the shared `API` instance the domain modules now import.
    expect(Object.keys(barrel)).toHaveLength(112)
  })

  it('keeps the OCR timeout long enough for handwriting recognition', () => {
    // Load-bearing: local OCR routinely runs past the 30s default, and a
    // regression here would surface as spurious cancellations mid-analysis.
    expect(barrel.OCR_TIMEOUT).toBe(300_000)
  })
})
