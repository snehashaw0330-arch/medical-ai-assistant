import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { LIST_SHAPE, buildClientMock } from '@/test/apiMock'
import { renderRoute, waitForRoute } from '@/test/renderRoute'

const gets = []

vi.mock('@/shared/api/client', () => {
  const mock = buildClientMock()
  mock.API.get.mockImplementation(async (url) => {
    gets.push(url)
    if (url.includes('/governance/models')) return { data: [] }
    return { data: LIST_SHAPE() }
  })
  return mock
})

describe('model registry loads its data', () => {
  it('fetches the model list on mount', async () => {
    renderRoute('/governance/models')
    await waitForRoute()
    await waitFor(() =>
      expect(gets.filter((u) => u.includes('/governance/models'))).not.toHaveLength(0),
    )
    expect(screen.getByRole('button', { name: /Register model/i })).toBeInTheDocument()
  })
})
