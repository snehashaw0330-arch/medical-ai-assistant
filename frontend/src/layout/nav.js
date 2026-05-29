import {
  LayoutDashboard,
  Stethoscope,
  ScanLine,
  Pill,
  MessageSquareText,
  User,
} from 'lucide-react'

export const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/predict', label: 'Disease Prediction', icon: Stethoscope },
  { to: '/ocr', label: 'Prescription OCR', icon: ScanLine },
  { to: '/medicine', label: 'Medicine Search', icon: Pill },
  { to: '/chat', label: 'AI Assistant', icon: MessageSquareText },
  { to: '/profile', label: 'Profile', icon: User },
]
