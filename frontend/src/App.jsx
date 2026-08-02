import { lazy } from 'react'
import { Routes, Route } from 'react-router-dom'
import AppLayout from './layout/AppLayout'

// Every page is code-split. Before this, all 28 pages shipped in one 1.07 MB
// chunk that had to parse before the dashboard could paint.
const Dashboard = lazy(() => import('./pages/Dashboard'))
const DiseasePrediction = lazy(() => import('./pages/DiseasePrediction'))
const SymptomChecker = lazy(() => import('./pages/SymptomChecker'))
const PrescriptionOCR = lazy(() => import('./pages/PrescriptionOCR'))
const DocumentIntelligence = lazy(() => import('./pages/DocumentIntelligence'))
const ClinicalDecision = lazy(() => import('./pages/ClinicalDecision'))
const ClinicalReasoning = lazy(() => import('./pages/ClinicalReasoning'))
const CopilotWorkspace = lazy(() => import('./pages/CopilotWorkspace'))
const TreatmentSimulator = lazy(() => import('./pages/TreatmentSimulator'))
const EvidenceVerification = lazy(() => import('./pages/EvidenceVerification'))
const EvidenceExplorer = lazy(() => import('./pages/EvidenceExplorer'))
const MedicalReports = lazy(() => import('./pages/MedicalReports'))
const PrescriptionHistory = lazy(() => import('./pages/PrescriptionHistory'))
const DatasetEvaluation = lazy(() => import('./pages/DatasetEvaluation'))
const KnowledgeBase = lazy(() => import('./pages/KnowledgeBase'))
const MedicineSearch = lazy(() => import('./pages/MedicineSearch'))
const MedicineRecommendations = lazy(() => import('./pages/MedicineRecommendations'))
const AgentMonitor = lazy(() => import('./pages/AgentMonitor'))
const DigitalTwin = lazy(() => import('./pages/DigitalTwin'))
const PatientContext = lazy(() => import('./pages/PatientContext'))
const AIGovernance = lazy(() => import('./pages/AIGovernance'))
const ModelRegistry = lazy(() => import('./pages/ModelRegistry'))
const DatasetRegistry = lazy(() => import('./pages/DatasetRegistry'))
const AuditLogs = lazy(() => import('./pages/AuditLogs'))
const PipelineViewer = lazy(() => import('./pages/PipelineViewer'))
const Chat = lazy(() => import('./pages/Chat'))
const Profile = lazy(() => import('./pages/Profile'))
const NotFound = lazy(() => import('./pages/NotFound'))

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Dashboard />} />
        <Route path="predict" element={<DiseasePrediction />} />
        <Route path="symptoms" element={<SymptomChecker />} />
        <Route path="ocr" element={<PrescriptionOCR />} />
        <Route path="documents" element={<DocumentIntelligence />} />
        <Route path="clinical" element={<ClinicalDecision />} />
        <Route path="reasoning" element={<ClinicalReasoning />} />
        <Route path="copilot" element={<CopilotWorkspace />} />
        <Route path="simulator" element={<TreatmentSimulator />} />
        <Route path="verification" element={<EvidenceVerification />} />
        <Route path="evidence" element={<EvidenceExplorer />} />
        <Route path="reports" element={<MedicalReports />} />
        <Route path="history" element={<PrescriptionHistory />} />
        <Route path="dataset" element={<DatasetEvaluation />} />
        <Route path="knowledge" element={<KnowledgeBase />} />
        <Route path="medicine" element={<MedicineSearch />} />
        <Route path="recommendations" element={<MedicineRecommendations />} />
        <Route path="agents" element={<AgentMonitor />} />
        <Route path="digital-twin" element={<DigitalTwin />} />
        <Route path="patient-context" element={<PatientContext />} />
        <Route path="governance" element={<AIGovernance />} />
        <Route path="governance/models" element={<ModelRegistry />} />
        <Route path="governance/datasets" element={<DatasetRegistry />} />
        <Route path="governance/audit-logs" element={<AuditLogs />} />
        <Route path="governance/pipeline" element={<PipelineViewer />} />
        <Route path="chat" element={<Chat />} />
        <Route path="profile" element={<Profile />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
