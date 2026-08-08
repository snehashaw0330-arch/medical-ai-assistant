/**
 * Barrel for the API layer.
 *
 * The implementation lives in `shared/api/<domain>.js`; this file keeps the
 * `@/lib/api` import path every page already uses working unchanged. Import
 * the domain module directly in new code.
 */
export { API, OCR_TIMEOUT } from '@/shared/api/client'
export * from '@/shared/api/disease'
export * from '@/shared/api/ocr'
export * from '@/shared/api/datasetEvaluation'
export * from '@/shared/api/history'
export * from '@/shared/api/medicineInfo'
export * from '@/shared/api/rag'
export * from '@/shared/api/interactions'
export * from '@/shared/api/clinical'
export * from '@/shared/api/reports'
export * from '@/shared/api/validation'
export * from '@/shared/api/symptoms'
export * from '@/shared/api/recommendations'
export * from '@/shared/api/agents'
export * from '@/shared/api/digitalTwin'
export * from '@/shared/api/patientContext'
export * from '@/shared/api/governance'
export * from '@/shared/api/reasoning'
export * from '@/shared/api/copilot'
export * from '@/shared/api/simulation'
export * from '@/shared/api/verification'
export * from '@/shared/api/documents'
export * from '@/shared/api/evidence'
export * from '@/shared/api/health'
