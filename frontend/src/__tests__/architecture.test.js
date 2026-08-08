import { describe, expect, it } from 'vitest'

/**
 * Structural rules the codebase is expected to keep. These are cheap to check
 * and expensive to notice by review: an import that quietly couples two
 * features looks completely ordinary at the point it is written.
 */

const files = import.meta.glob('@/**/*.{js,jsx}', { eager: true, query: '?raw' })

const source = Object.fromEntries(
  Object.entries(files).map(([path, mod]) => [path.replace(/^.*\/src\//, ''), mod.default]),
)

const importsOf = (code) =>
  [...code.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1])

const FEATURES = [
  'clinical',
  'copilot',
  'dashboard',
  'governance',
  'intake',
  'knowledge',
  'patients',
  'profile',
]

describe('feature isolation', () => {
  it.each(FEATURES)('%s imports no other feature', (feature) => {
    const offenders = []
    for (const [path, code] of Object.entries(source)) {
      if (!path.startsWith(`features/${feature}/`)) continue
      for (const spec of importsOf(code)) {
        const match = spec.match(/^@\/features\/([a-z-]+)/)
        if (match && match[1] !== feature) offenders.push(`${path} -> ${spec}`)
      }
    }
    // Anything two features both need belongs in shared/ or ui/, not in
    // whichever feature happened to define it first. ClinicalReport and
    // ReasoningPipeline are exactly this case and live in shared/reports/.
    expect(offenders).toEqual([])
  })
})

describe('layering', () => {
  it('keeps ui/ free of domain knowledge', () => {
    const offenders = []
    for (const [path, code] of Object.entries(source)) {
      if (!path.startsWith('ui/')) continue
      for (const spec of importsOf(code)) {
        if (/^@\/(features|shared\/(api|reports))/.test(spec)) {
          offenders.push(`${path} -> ${spec}`)
        }
      }
    }
    // ui/ is primitives. The moment one of them fetches or renders a clinical
    // report, it stops being reusable and starts being a page fragment.
    expect(offenders).toEqual([])
  })

  it('keeps the API layer free of React', () => {
    const offenders = []
    for (const [path, code] of Object.entries(source)) {
      if (!path.startsWith('shared/api/')) continue
      for (const spec of importsOf(code)) {
        if (spec === 'react' || spec.startsWith('@/ui')) offenders.push(`${path} -> ${spec}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('routes every page through the route table', () => {
    // A page component that nothing routes to is dead weight; one routed
    // outside the table would be invisible to the sidebar and the palette.
    const pageFiles = Object.keys(source).filter((p) =>
      /^features\/[a-z]+\/[A-Z]\w+\.jsx$/.test(p),
    )
    const table = source['app/routes.js']
    const unrouted = pageFiles.filter((p) => {
      const name = p.replace(/^features\//, '').replace(/\.jsx$/, '')
      return !table.includes(`@/features/${name}'`)
    })
    expect(unrouted).toEqual([])
  })
})
