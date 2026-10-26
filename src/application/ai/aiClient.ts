import type { UserQuota } from '../auth/authClient'

export type ProviderStatus = {
  configured: boolean
  provider: string
  model: string | null
}

export type AiUsage = {
  promptTokens: number | null
  completionTokens: number | null
  totalTokens: number | null
}

export type AiExecution = {
  content: string
  model: string
  usage: AiUsage
  durationMs: number
  quota?: UserQuota
}

export type AiEvaluation = {
  score: number
  summary: string
  strengths: string[]
  improvements: string[]
  usage: AiUsage
  durationMs: number
  quota?: UserQuota
  criteria: Array<{
    criterion: string
    status: 'met' | 'partial' | 'missing'
    reason: string
  }>
}

export class AiRequestError extends Error {
  constructor(message: string, readonly quota?: UserQuota) {
    super(message)
    this.name = 'AiRequestError'
  }
}

function isUserQuota(value: unknown): value is UserQuota {
  if (!value || typeof value !== 'object') return false
  const quota = value as Partial<UserQuota>
  return (
    Number.isInteger(quota.limit) &&
    Number.isInteger(quota.used) &&
    Number.isInteger(quota.runs) &&
    Number.isInteger(quota.evaluations) &&
    Number.isInteger(quota.remaining) &&
    typeof quota.resetsAt === 'string'
  )
}

async function request<T>(path: string, body?: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (cause) {
    console.error('PromptOS could not reach its AI server.', cause)
    throw new Error('The PromptOS server is unreachable. Start the app server and try again.')
  }

  let value: unknown
  try {
    value = await response.json()
  } catch (cause) {
    console.error('PromptOS received an invalid server response.', cause)
    throw new Error('The server returned an invalid response. Check the server logs and try again.')
  }

  if (!response.ok) {
    const errorMessage =
      value && typeof value === 'object' && 'error' in value && typeof value.error === 'string'
        ? value.error
        : `The server returned HTTP ${response.status}.`
    const quota = value && typeof value === 'object' && 'quota' in value ? value.quota : undefined
    throw new AiRequestError(errorMessage, isUserQuota(quota) ? quota : undefined)
  }
  return value as T
}

export function getProviderStatus() {
  return request<ProviderStatus>('/api/health')
}

export function executePrompt(prompt: string, input: string) {
  return request<AiExecution>('/api/chat', { prompt, input })
}

export function evaluateResponse(prompt: string, answer: string) {
  return request<AiEvaluation>('/api/evaluate', { prompt, answer })
}
