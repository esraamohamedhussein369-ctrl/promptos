import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '../components/layout/AppShell'
import { RequireAuth } from '../components/layout/RequireAuth'
import { AuthPage } from '../features/auth/AuthPage'
import { PrivacyPage } from '../features/auth/PrivacyPage'
import { TermsPage } from '../features/auth/TermsPage'
import { AdminDashboardPage } from '../features/admin/AdminDashboardPage'
import { WorkspacePage } from '../features/workspace/WorkspacePage'
import { PromptBuilderPage } from '../features/prompt-builder/PromptBuilderPage'
import { RolesPage } from '../features/roles/RolesPage'
import { PromptIntelligencePage } from '../features/intelligence/PromptIntelligencePage'
import { ThinkFirstPage } from '../features/think-first/ThinkFirstPage'
import { TemplatesPage } from '../features/templates/TemplatesPage'
import { VersionsPage } from '../features/versioning/VersionsPage'
import { PromptExecutionPage } from '../features/execution/PromptExecutionPage'
import { useAuth } from '../application/auth/AuthContext'

export default function App() {
  const { user } = useAuth()
  return (
    <Routes>
      <Route path="/login" element={<AuthPage />} />
      <Route path="/terms" element={<TermsPage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route element={<RequireAuth />}>
      <Route element={<AppShell />}>
        <Route path="/" element={<Navigate to="/workspace" replace />} />
        <Route path="/workspace" element={<WorkspacePage />} />
        <Route path="/builder" element={<PromptBuilderPage />} />
        <Route path="/execute" element={<PromptExecutionPage />} />
        <Route path="/admin" element={user?.role === 'admin' ? <AdminDashboardPage /> : <Navigate to="/workspace" replace />} />
        <Route path="/roles" element={<RolesPage />} />
          <Route path="/intelligence" element={<PromptIntelligencePage />} />
          <Route path="/think-first" element={<ThinkFirstPage />} />
          <Route path="/templates" element={<TemplatesPage />} />
          <Route path="/versions" element={<VersionsPage />} />
        <Route path="*" element={<Navigate to="/workspace" replace />} />
      </Route>
      </Route>
    </Routes>
  )
}