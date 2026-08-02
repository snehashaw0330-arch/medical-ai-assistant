import { describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import { NAV_ITEMS } from '@/layout/nav'
import { buildClientMock } from '@/test/apiMock'
import { collectRealRoutePaths } from '@/test/routeInventory'
import { renderRoute, waitForRoute } from '@/test/renderRoute'

vi.mock('@/shared/api/client', () => buildClientMock())

describe('navigation contract', () => {
  const routes = new Set(collectRealRoutePaths())

  it('points every sidebar entry at a route that exists', () => {
    const dead = NAV_ITEMS.filter((item) => !routes.has(item.to))
    expect(dead.map((d) => d.to)).toEqual([])
  })

  it('leaves no route unreachable from the sidebar', () => {
    // Every page must be linked. When a route intentionally stops being a
    // sidebar destination (Profile moving into the topbar menu, a page becoming
    // a tab panel), add it here with the reason.
    const INTENTIONALLY_UNLINKED = []
    const targets = new Set(NAV_ITEMS.map((i) => i.to))
    const orphans = [...routes].filter(
      (p) => !targets.has(p) && !INTENTIONALLY_UNLINKED.includes(p),
    )
    expect(orphans).toEqual([])
  })

  it('has unique paths and labels', () => {
    expect(new Set(NAV_ITEMS.map((i) => i.to)).size).toBe(NAV_ITEMS.length)
    expect(new Set(NAV_ITEMS.map((i) => i.label)).size).toBe(NAV_ITEMS.length)
  })

  it('gives every entry an icon', () => {
    const iconless = NAV_ITEMS.filter((i) => !i.icon).map((i) => i.label)
    expect(iconless).toEqual([])
  })

  // Title resolution is prefix-based and therefore order-sensitive: without
  // this, a nested route added above its parent would silently mistitle the
  // page. Asserting per entry pins the behaviour before the sidebar is rebuilt.
  it.each(NAV_ITEMS.map((i) => [i.to, i.label]))(
    '%s titles the page "%s"',
    async (to, label) => {
      renderRoute(to)
      await waitForRoute()
      // Scoped to the topbar: several pages repeat their own name in an <h1>,
      // and it is the topbar's resolution that is under test here.
      const header = within(screen.getByRole('banner'))
      expect(header.getByRole('heading', { level: 1 })).toHaveTextContent(label)
    },
  )
})
