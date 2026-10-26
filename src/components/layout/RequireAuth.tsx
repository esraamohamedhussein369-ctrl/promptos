import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../../application/auth/AuthContext'

export function RequireAuth() {
  const { user, isLoading, serverError } = useAuth()
  if (isLoading) return <main className="auth-page"><p role="status">Checking your session…</p></main>
  if (serverError) return <main className="auth-page"><div className="alert error" role="alert">{serverError}</div></main>
  if (!user) return <Navigate to="/login" replace />
  return <Outlet />
}
