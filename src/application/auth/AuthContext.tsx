import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  getAuthSession,
  signIn,
  signOut,
  type AuthSession,
  type AuthUser,
  type UserQuota,
} from './authClient'
import { setAiAnalyticsOwner } from '../persistence/aiAnalytics'
import { activatePromptOwner } from '../store/usePromptStore'

type AuthContextValue = {
  user: AuthUser | null
  quota: UserQuota | null
  aiConfigured: boolean
  isLoading: boolean
  serverError: string
  authenticate: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  refreshSession: () => Promise<void>
  updateQuota: (quota: UserQuota) => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

function applySession(session: AuthSession | null, setState: (session: AuthSession | null) => void) {
  setState(session)
  const ownerId = session?.user.id ?? null
  activatePromptOwner(ownerId)
  setAiAnalyticsOwner(ownerId)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [serverError, setServerError] = useState('')

  const refreshSession = useCallback(async () => {
    try {
      const nextSession = await getAuthSession()
      applySession(nextSession, setSession)
      setServerError('')
    } catch (error) {
      setServerError(error instanceof Error ? error.message : 'Unable to check your account.')
      throw error
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshSession().catch(() => {})
  }, [refreshSession])

  const authenticate = useCallback(async (email: string, password: string) => {
    const nextSession = await signIn(email, password)
    if (!nextSession) throw new Error('The server did not return an account session.')
    applySession(nextSession, setSession)
    setServerError('')
  }, [])

  const logout = useCallback(async () => {
    await signOut()
    applySession(null, setSession)
  }, [])

  const updateQuota = useCallback((quota: UserQuota) => {
    setSession((current) => (current ? { ...current, quota } : current))
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      quota: session?.quota ?? null,
      aiConfigured: session?.aiConfigured ?? false,
      isLoading,
      serverError,
      authenticate,
      logout,
      refreshSession,
      updateQuota,
    }),
    [session, isLoading, serverError, authenticate, logout, refreshSession, updateQuota],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider.')
  return context
}
