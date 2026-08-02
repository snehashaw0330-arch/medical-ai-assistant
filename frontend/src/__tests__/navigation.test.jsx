import { describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NAV_TREE, ROUTES, ROUTE_TREE, findRoute } from '@/app/routes'
import { buildClientMock } from '@/test/apiMock'
import { renderRoute, waitForRoute } from '@/test/renderRoute'

vi.mock('@/shared/api/client', () => buildClientMock())

describe('sidebar structure', () => {
  it('shows seven top-level entries', () => {
    // The point of Phase 2. If this climbs back up, the sidebar is regrowing
    // into the flat list of every route that it used to be.
    expect(NAV_TREE).toHaveLength(7)
  })

  it('hides Profile from the sidebar while keeping it routable', () => {
    expect(NAV_TREE.find((n) => n.id === 'profile')).toBeUndefined()
    expect(ROUTES.find((r) => r.to === '/profile')).toBeDefined()
  })

  it('gives every group a stable id, icon and at least two items', () => {
    const groups = ROUTE_TREE.filter((n) => n.items)
    for (const g of groups) {
      expect(g.id, `group ${g.label} needs an id`).toBeTruthy()
      expect(g.icon, `group ${g.label} needs an icon`).toBeTruthy()
      // A one-item group is just a link wearing a disclosure triangle.
      expect(g.items.length, `group ${g.label}`).toBeGreaterThan(1)
    }
    expect(new Set(groups.map((g) => g.id)).size).toBe(groups.length)
  })

  it('renders every group heading', async () => {
    renderRoute('/')
    await waitForRoute()
    const nav = within(screen.getByRole('navigation', { name: 'Main' }))
    for (const node of NAV_TREE.filter((n) => n.items)) {
      expect(
        nav.getByRole('button', { name: new RegExp(node.label) }),
      ).toBeInTheDocument()
    }
  })

  it('rests at seven rows with no group opened', async () => {
    // The whole point, and it was briefly wrong: groups defaulted to open, so
    // all 26 destinations were still on screen with disclosure triangles added.
    // On a page that belongs to no group, nothing should be expanded.
    renderRoute('/')
    await waitForRoute()
    const nav = within(screen.getByRole('navigation', { name: 'Main' }))

    expect(nav.getAllByRole('button')).toHaveLength(6) // six collapsible groups
    expect(nav.getAllByRole('link')).toHaveLength(1) // Dashboard only
  })

  it('expands the group containing the current page', async () => {
    renderRoute('/governance/models')
    await waitForRoute()
    const nav = within(screen.getByRole('navigation', { name: 'Main' }))

    expect(nav.getByRole('button', { name: /Governance/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    // Its items are therefore reachable without any interaction.
    expect(nav.getByRole('link', { name: /Models/ })).toBeInTheDocument()
    // An unrelated group's items stay out of the way.
    expect(nav.queryByRole('link', { name: /Digital Twin/ })).not.toBeInTheDocument()
  })

  it('collapses and re-expands a group on click', async () => {
    const user = userEvent.setup()
    renderRoute('/governance/models')
    await waitForRoute()
    const nav = within(screen.getByRole('navigation', { name: 'Main' }))
    const heading = nav.getByRole('button', { name: /Governance/ })

    await user.click(heading)
    expect(heading).toHaveAttribute('aria-expanded', 'false')
    expect(nav.queryByRole('link', { name: /Models/ })).not.toBeInTheDocument()

    await user.click(heading)
    expect(heading).toHaveAttribute('aria-expanded', 'true')
    expect(nav.getByRole('link', { name: /Models/ })).toBeInTheDocument()
  })
})

describe('route resolution', () => {
  it.each(ROUTES.map((r) => [r.to, r.label]))('resolves %s to "%s"', (to, label) => {
    expect(findRoute(to)?.label).toBe(label)
  })

  it('prefers the most specific route over a shorter prefix', () => {
    // The old topbar took the first `startsWith` hit in array order, so
    // '/governance' could shadow every route nested beneath it.
    expect(findRoute('/governance')?.label).toBe('Overview')
    expect(findRoute('/governance/models')?.label).toBe('Models')
    expect(findRoute('/knowledge/medicines')?.label).toBe('Medicines')
    expect(findRoute('/knowledge/medicines/alternatives')?.label).toBe('Alternatives')
  })

  it('does not match a route that is merely a string prefix', () => {
    // '/copilot' must not claim '/copilot-other'.
    expect(findRoute('/copilot-other')).toBeUndefined()
  })

  it('returns nothing for an unknown path', () => {
    expect(findRoute('/nope')).toBeUndefined()
  })
})

describe('topbar', () => {
  it.each(ROUTES.map((r) => [r.to, r.label]))('%s is titled "%s"', async (to, label) => {
    renderRoute(to)
    await waitForRoute()
    // Scoped to the topbar: several pages repeat their own name in an <h1>,
    // and it is the topbar's resolution that is under test here.
    const header = within(screen.getByRole('banner'))
    expect(header.getByRole('heading', { level: 1 })).toHaveTextContent(label)
  })

  it('shows the group in a breadcrumb', async () => {
    renderRoute('/clinical/reasoning')
    await waitForRoute()
    const crumb = within(screen.getByRole('banner')).getByRole('navigation', {
      name: 'Breadcrumb',
    })
    expect(crumb).toHaveTextContent('Clinical')
    expect(crumb).toHaveTextContent('Reasoning')
  })

  it('reaches Profile through the account menu', async () => {
    const user = userEvent.setup()
    renderRoute('/')
    await waitForRoute()

    await user.click(screen.getByRole('button', { name: 'Account menu' }))
    await user.click(screen.getByRole('link', { name: /Profile/ }))
    await waitForRoute()

    const header = within(screen.getByRole('banner'))
    expect(header.getByRole('heading', { level: 1 })).toHaveTextContent('Profile')
  })
})

describe('command palette', () => {
  const open = async (user) => {
    await user.keyboard('{Meta>}k{/Meta}')
    return screen.getByRole('dialog', { name: 'Search pages' })
  }

  it('opens on Cmd+K and lists every destination', async () => {
    const user = userEvent.setup()
    renderRoute('/')
    await waitForRoute()

    const dialog = await open(user)
    // This is what makes a seven-entry sidebar acceptable: nothing is more
    // than one keystroke away, including pages nested two levels deep.
    expect(within(dialog).getAllByRole('button')).toHaveLength(ROUTES.length)
  })

  it('filters across the group name as well as the page name', async () => {
    const user = userEvent.setup()
    renderRoute('/')
    await waitForRoute()

    const dialog = await open(user)
    await user.type(within(dialog).getByRole('textbox'), 'gov models')
    const hits = within(dialog).getAllByRole('button')
    expect(hits).toHaveLength(1)
    expect(hits[0]).toHaveTextContent('Models')
  })

  it('navigates on Enter', async () => {
    const user = userEvent.setup()
    renderRoute('/')
    await waitForRoute()

    const dialog = await open(user)
    await user.type(within(dialog).getByRole('textbox'), 'digital twin')
    await user.keyboard('{Enter}')
    await waitForRoute()

    const header = within(screen.getByRole('banner'))
    expect(header.getByRole('heading', { level: 1 })).toHaveTextContent('Digital Twin')
  })

  it('closes on Escape', async () => {
    const user = userEvent.setup()
    renderRoute('/')
    await waitForRoute()

    await open(user)
    await user.keyboard('{Escape}')
    expect(
      screen.queryByRole('dialog', { name: 'Search pages' }),
    ).not.toBeInTheDocument()
  })
})
