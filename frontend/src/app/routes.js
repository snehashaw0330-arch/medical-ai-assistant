import { lazy } from 'react'
import {
  ActivitySquare,
  BadgeCheck,
  Boxes,
  Bot,
  Brain,
  BrainCircuit,
  Database,
  FileSearch,
  FileText,
  FlaskConical,
  HeartPulse,
  History,
  Inbox,
  LayoutDashboard,
  Library,
  MessageSquareText,
  Network,
  Layers,
  Pill,
  ScanLine,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  User,
  Users,
  Waypoints,
  BookOpen,
  Workflow,
} from 'lucide-react'

const Dashboard = lazy(() => import('@/pages/Dashboard'))
const CopilotWorkspace = lazy(() => import('@/pages/CopilotWorkspace'))
const Chat = lazy(() => import('@/pages/Chat'))
const PrescriptionOCR = lazy(() => import('@/pages/PrescriptionOCR'))
const DocumentIntelligence = lazy(() => import('@/pages/DocumentIntelligence'))
const PrescriptionHistory = lazy(() => import('@/pages/PrescriptionHistory'))
const MedicalReports = lazy(() => import('@/pages/MedicalReports'))
const ClinicalDecision = lazy(() => import('@/pages/ClinicalDecision'))
const ClinicalReasoning = lazy(() => import('@/pages/ClinicalReasoning'))
const SymptomChecker = lazy(() => import('@/pages/SymptomChecker'))
const DiseasePrediction = lazy(() => import('@/pages/DiseasePrediction'))
const TreatmentSimulator = lazy(() => import('@/pages/TreatmentSimulator'))
const PatientContext = lazy(() => import('@/pages/PatientContext'))
const DigitalTwin = lazy(() => import('@/pages/DigitalTwin'))
const MedicineSearch = lazy(() => import('@/pages/MedicineSearch'))
const MedicineRecommendations = lazy(() => import('@/pages/MedicineRecommendations'))
const KnowledgeBase = lazy(() => import('@/pages/KnowledgeBase'))
const EvidenceExplorer = lazy(() => import('@/pages/EvidenceExplorer'))
const EvidenceVerification = lazy(() => import('@/pages/EvidenceVerification'))
const AIGovernance = lazy(() => import('@/pages/AIGovernance'))
const PipelineViewer = lazy(() => import('@/pages/PipelineViewer'))
const ModelRegistry = lazy(() => import('@/pages/ModelRegistry'))
const DatasetRegistry = lazy(() => import('@/pages/DatasetRegistry'))
const AuditLogs = lazy(() => import('@/pages/AuditLogs'))
const AgentMonitor = lazy(() => import('@/pages/AgentMonitor'))
const DatasetEvaluation = lazy(() => import('@/pages/DatasetEvaluation'))
const Profile = lazy(() => import('@/pages/Profile'))

/**
 * The one place the application's structure is declared.
 *
 * The router, the sidebar, the topbar title, the breadcrumb and the command
 * palette are all derived from this array. Previously the routes lived in JSX
 * and the sidebar kept a parallel hand-maintained list, which is how the topbar
 * ended up resolving titles by scanning that list with `startsWith`.
 *
 * A group is a sidebar heading; `items` are its routes. A top-level entry with
 * a `to` is a standalone destination. `hidden: true` keeps a route out of the
 * sidebar without making it unreachable.
 */
export const ROUTE_TREE = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    to: '/',
    end: true,
    element: Dashboard,
  },
  {
    id: 'copilot',
    label: 'Copilot',
    icon: Bot,
    items: [
      { to: '/copilot', label: 'Workspace', icon: Sparkles, element: CopilotWorkspace, end: true },
      { to: '/copilot/chat', label: 'Chat', icon: MessageSquareText, element: Chat },
    ],
  },
  {
    id: 'intake',
    label: 'Intake & Records',
    icon: Inbox,
    items: [
      { to: '/intake/prescription', label: 'Prescription', icon: ScanLine, element: PrescriptionOCR },
      { to: '/intake/documents', label: 'Documents', icon: FileSearch, element: DocumentIntelligence },
      { to: '/intake/history', label: 'History', icon: History, element: PrescriptionHistory },
      { to: '/intake/reports', label: 'Reports', icon: FileText, element: MedicalReports },
    ],
  },
  {
    id: 'clinical',
    label: 'Clinical',
    icon: Stethoscope,
    items: [
      { to: '/clinical/decision', label: 'Decision Support', icon: BrainCircuit, element: ClinicalDecision },
      { to: '/clinical/reasoning', label: 'Reasoning', icon: Waypoints, element: ClinicalReasoning },
      { to: '/clinical/symptoms', label: 'Symptom Checker', icon: ActivitySquare, element: SymptomChecker },
      { to: '/clinical/disease', label: 'Disease Prediction', icon: Stethoscope, element: DiseasePrediction },
      { to: '/clinical/simulator', label: 'Treatment Simulator', icon: FlaskConical, element: TreatmentSimulator },
    ],
  },
  {
    id: 'patients',
    label: 'Patients',
    icon: Users,
    items: [
      { to: '/patients/context', label: 'Patient Context', icon: Brain, element: PatientContext },
      { to: '/patients/digital-twin', label: 'Digital Twin', icon: HeartPulse, element: DigitalTwin },
    ],
  },
  {
    id: 'knowledge',
    label: 'Knowledge',
    icon: BookOpen,
    items: [
      { to: '/knowledge/medicines', label: 'Medicines', icon: Pill, element: MedicineSearch, end: true },
      { to: '/knowledge/medicines/alternatives', label: 'Alternatives', icon: Sparkles, element: MedicineRecommendations },
      { to: '/knowledge/base', label: 'Knowledge Base', icon: Library, element: KnowledgeBase },
      { to: '/knowledge/evidence', label: 'Evidence', icon: BookOpen, element: EvidenceExplorer },
      { to: '/knowledge/verify', label: 'Verification', icon: BadgeCheck, element: EvidenceVerification },
    ],
  },
  {
    id: 'governance',
    label: 'Governance',
    icon: ShieldCheck,
    items: [
      { to: '/governance', label: 'Overview', icon: ShieldCheck, element: AIGovernance, end: true },
      { to: '/governance/pipeline', label: 'Pipeline', icon: Network, element: PipelineViewer },
      { to: '/governance/models', label: 'Models', icon: Boxes, element: ModelRegistry },
      { to: '/governance/datasets', label: 'Datasets', icon: Layers, element: DatasetRegistry },
      { to: '/governance/audit', label: 'Audit Logs', icon: ScrollText, element: AuditLogs },
      { to: '/governance/agents', label: 'Agents', icon: Workflow, element: AgentMonitor },
      // Renamed from "Dataset Evaluation": this is the OCR benchmark harness,
      // and sitting next to the governance Dataset Registry under the old name
      // made two unrelated things look like a pair.
      { to: '/governance/benchmarks', label: 'Benchmarks', icon: Database, element: DatasetEvaluation },
    ],
  },
  {
    id: 'profile',
    label: 'Profile',
    icon: User,
    to: '/profile',
    element: Profile,
    // Reachable from the topbar avatar menu, deliberately not a sidebar row.
    hidden: true,
  },
]

/**
 * Permanent redirects from the pre-Phase-2 flat URLs. Bookmarks and any link
 * shared before the restructure keep working.
 */
export const LEGACY_REDIRECTS = {
  '/ocr': '/intake/prescription',
  '/documents': '/intake/documents',
  '/history': '/intake/history',
  '/reports': '/intake/reports',
  '/clinical': '/clinical/decision',
  '/reasoning': '/clinical/reasoning',
  '/symptoms': '/clinical/symptoms',
  '/predict': '/clinical/disease',
  '/simulator': '/clinical/simulator',
  '/patient-context': '/patients/context',
  '/digital-twin': '/patients/digital-twin',
  '/medicine': '/knowledge/medicines',
  '/recommendations': '/knowledge/medicines/alternatives',
  '/knowledge': '/knowledge/base',
  '/evidence': '/knowledge/evidence',
  '/verification': '/knowledge/verify',
  '/agents': '/governance/agents',
  '/dataset': '/governance/benchmarks',
  '/governance/audit-logs': '/governance/audit',
  '/chat': '/copilot/chat',
}

/** Every leaf destination, flattened, with its group attached. */
export const ROUTES = ROUTE_TREE.flatMap((node) =>
  node.items
    ? node.items.map((item) => ({ ...item, group: node }))
    : [{ ...node, group: null }],
)

/** Sidebar-visible structure only. */
export const NAV_TREE = ROUTE_TREE.filter((node) => !node.hidden)

/**
 * Resolve a pathname to its route.
 *
 * Exact match first, then the longest route whose path is a *segment* prefix.
 * The old implementation took the first `startsWith` hit in array order, which
 * made '/governance' shadow '/governance/models' unless the entries happened to
 * be ordered correctly.
 */
export function findRoute(pathname) {
  const exact = ROUTES.find((r) => r.to === pathname)
  if (exact) return exact

  return ROUTES.filter((r) => r.to !== '/' && pathname.startsWith(`${r.to}/`)).sort(
    (a, b) => b.to.length - a.to.length,
  )[0]
}
