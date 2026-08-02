import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// jsdom implements neither of these, and both are reached during a normal page
// render — recharts measures its container, the theme toggle probes the media
// query. Without them pages throw on mount and every route test fails for a
// reason that has nothing to do with the route.
if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })
}

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver ??= ResizeObserverStub
window.IntersectionObserver ??= ResizeObserverStub

window.scrollTo ??= () => {}
URL.createObjectURL ??= () => 'blob:test'
URL.revokeObjectURL ??= () => {}

// jsdom ships no scroll implementation on elements. Chat and the copilot
// transcript both scroll themselves to the bottom on mount, which is a
// TypeError rather than a no-op without these.
Element.prototype.scrollTo ??= () => {}
Element.prototype.scrollIntoView ??= () => {}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})
