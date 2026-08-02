import { vi } from 'vitest'

/**
 * Auto-mock for the API layer.
 *
 * Built by reflecting over the *real* module's exports rather than listing them,
 * so it keeps working when `lib/api.js` is split into per-domain modules. Any
 * endpoint added later is mocked the moment it exists — a test can never pass
 * because it silently missed a new network call.
 *
 * Resolution rules, in order:
 *   1. an explicit entry in RESPONSES (only where a page needs a real shape)
 *   2. `*Url` helpers      -> a stub string
 *   3. `fetch*Blob` helpers -> an empty Blob
 *   4. everything else      -> LIST_SHAPE, which satisfies both `res.items.map`
 *      and `res.total` style readers without enumerating 93 endpoints.
 */

// Generic envelope: every list key a page might destructure, all empty.
const LIST_SHAPE = () => ({
  items: [],
  results: [],
  history: [],
  records: [],
  entries: [],
  logs: [],
  medicines: [],
  symptoms: [],
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
  total: 0,
  count: 0,
})

// Endpoints whose page reads a shape the generic envelope cannot satisfy.
// Keep this list short — each entry is a page coupling worth knowing about.
const RESPONSES = {
  getSymptoms: () => [],
  getSymptomCatalog: () => [],
  suggestSymptoms: () => [],
  suggestSymptomTerms: () => [],
  getHistoryMedicines: () => [],
  getDigitalTwinPatients: () => [],
  listPatientContexts: () => [],
  getAgentRegistry: () => [],
  getGovernanceModels: () => [],
  getGovernanceDatasets: () => [],
  getHealth: () => ({ status: 'ok' }),
}

export async function buildApiMock(importOriginal) {
  const actual = await importOriginal()
  const mock = {}

  for (const [name, value] of Object.entries(actual)) {
    if (typeof value !== 'function') {
      mock[name] = value // constants such as OCR_TIMEOUT pass through
      continue
    }
    if (name.endsWith('Url')) {
      mock[name] = vi.fn(() => `/stub/${name}`)
    } else if (/^fetch.*Blob$/.test(name)) {
      mock[name] = vi.fn(async () => new Blob(['stub']))
    } else {
      const shape = RESPONSES[name] ?? LIST_SHAPE
      mock[name] = vi.fn(async () => shape())
    }
  }
  return mock
}
