export type AuthUser = {
  id: string
  email: string
  role: 'admin' | 'user'
}

export type UserQuota = {
  limit: number
  used: number
  runs: number
  evaluations: number
  remaining: number
  resetsAt: string
}

export type AuthSession = {
  user: AuthUser
  quota: UserQuota
  aiConfigured: boolean
}

export type AdminOverview = {
  activeUsers: number
  dailyLimit: number
  recentEvents: Array<{
    event_type: string
    outcome: string
    created_at: number
    email: string | null
  }>
  recentUsage: Array<{
    email: string
    request_type: string
    status: string
    created_at: number
    duration_ms: number | null
    total_tokens: number | null
    model: string | null
  }>
}

async function authRequest(path: string, body?: unknown): Promise<AuthSession | null> {
  let response: Response
  try {
    response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (cause) {
    console.error('PromptOS could not reach the account server.', cause)
    throw new Error('The PromptOS server is unreachable. Start the app server and try again.')
  }

  let value: unknown
  try {
    value = await response.json()
  } catch (cause) {
    console.error('PromptOS received an invalid account response.', cause)
    throw new Error('The account server returned an invalid response.')
  }

  if (path === '/api/auth/me' && response.ok && value && typeof value === 'object' && 'user' in value && value.user === null) {
    return null
  }
  if (response.status === 401 && path === '/api/auth/me') return null
  if (!response.ok) {
    const message =
      value && typeof value === 'object' && 'error' in value && typeof value.error === 'string'
        ? value.error
        : `Account request failed with HTTP ${response.status}.`
    throw new Error(message)
  }
  if (path === '/api/auth/logout') return null
  return value as AuthSession
}

async function accountAction(path: string, body: unknown): Promise<{ message?: string }> {
  let response: Response
  try {
    response = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (cause) {
    console.error('PromptOS could not reach the account server.', cause)
    throw new Error('The PromptOS server is unreachable. Start the app server and try again.')
  }

  let value: unknown
  try {
    value = await response.json()
  } catch (cause) {
    console.error('PromptOS received an invalid account response.', cause)
    throw new Error('The account server returned an invalid response.')
  }
  if (!response.ok) {
    const message =
      value && typeof value === 'object' && 'error' in value && typeof value.error === 'string'
        ? value.error
        : `Account request failed with HTTP ${response.status}.`
    throw new Error(message)
  }
  return value as { message?: string }
}

export function getAuthSession() {
  return authRequest('/api/auth/me')
}

export function signIn(email: string, password: string) {
  return authRequest('/api/auth/login', { email, password })
}

export function registerAccount(email: string, password: string) {
  return accountAction('/api/auth/register', { email, password })
}

export function verifyEmail(token: string) {
  return accountAction('/api/auth/verify-email', { token })
}

export function resendVerification(email: string) {
  return accountAction('/api/auth/resend-verification', { email })
}

export function requestPasswordReset(email: string) {
  return accountAction('/api/auth/forgot-password', { email })
}

export function resetPassword(token: string, password: string) {
  return accountAction('/api/auth/reset-password', { token, password })
}

export function signOut() {
  return authRequest('/api/auth/logout', {})
}

export async function getAdminOverview(): Promise<AdminOverview> {
  let response: Response
  try {
    response = await fetch('/api/admin/overview', { credentials: 'same-origin' })
  } catch (cause) {
    console.error('PromptOS could not load security monitoring.', cause)
    throw new Error('The PromptOS server is unreachable.')
  }
  const value: unknown = await response.json()
  if (!response.ok) {
    const message =
      value && typeof value === 'object' && 'error' in value && typeof value.error === 'string'
        ? value.error
        : `Admin request failed with HTTP ${response.status}.`
    throw new Error(message)
  }
  return value as AdminOverview
}
