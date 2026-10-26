import { createServer as createHttpServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer as createViteServer } from 'vite'
import {
  clearSessionCookie,
  createSecurityStore,
  readCookie,
  safeEqual,
  sessionCookie,
  sessionCookieName,
} from './securityStore.mjs'
import { createResendEmailSender } from './email.mjs'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const defaultBaseUrl = 'https://api.openai.com/v1'
const maxBodyBytes = 160_000
const rateLimitWindowMs = 60_000
const rateLimitRequests = 30
const sessionLifetimeSeconds = 7 * 24 * 60 * 60

const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json'],
  ['.webp', 'image/webp'],
])

function sendJson(response, status, value) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  response.end(JSON.stringify(value))
}

async function readJsonBody(request) {
  if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
    const error = new Error('Send this request as application/json.')
    error.status = 415
    throw error
  }

  const contentLength = Number(request.headers['content-length'] ?? 0)
  if (contentLength > maxBodyBytes) {
    const error = new Error('The request is too large.')
    error.status = 413
    throw error
  }

  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > maxBodyBytes) {
      const error = new Error('The request is too large.')
      error.status = 413
      throw error
    }
    chunks.push(chunk)
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    const error = new Error('The request body must contain valid JSON.')
    error.status = 400
    throw error
  }
}

function requireString(value, field, maximumLength) {
  if (typeof value !== 'string' || !value.trim()) {
    const error = new Error(`${field} is required.`)
    error.status = 400
    throw error
  }
  if (value.length > maximumLength) {
    const error = new Error(`${field} must be ${maximumLength} characters or fewer.`)
    error.status = 400
    throw error
  }
  return value.trim()
}

function ensureAllowedOrigin(request) {
  const origin = request.headers.origin
  if (!origin) return

  try {
    if (new URL(origin).host === request.headers.host) return
  } catch {
    // Invalid origins are rejected below.
  }
  const error = new Error('Cross-origin requests are not allowed.')
  error.status = 403
  throw error
}

function getMessageContent(value) {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value
    .filter((part) => part && part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
}

async function callProvider({ config, fetchImpl, system, user }) {
  if (!config.apiKey) {
    const error = new Error('AI is not configured on this server. Add OPENAI_API_KEY to its .env file.')
    error.status = 503
    throw error
  }

  let response
  try {
    response = await fetchImpl(`${config.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        max_tokens: config.maxTokens,
      }),
      signal: AbortSignal.timeout(config.timeoutMs),
    })
  } catch (cause) {
    if (cause?.name === 'TimeoutError' || cause?.name === 'AbortError') {
      const error = new Error('The AI provider timed out. Please try again.')
      error.status = 504
      throw error
    }
    const error = new Error('Could not reach the AI provider. Check the server connection and provider URL.')
    error.status = 502
    throw error
  }

  if (!response.ok) {
    const error = new Error(`The AI provider returned HTTP ${response.status}. Check the model, API key, and provider quota.`)
    error.status = 502
    throw error
  }

  let data
  try {
    data = await response.json()
  } catch {
    const error = new Error('The AI provider returned an invalid response.')
    error.status = 502
    throw error
  }

  const content = getMessageContent(data?.choices?.[0]?.message?.content)
  if (!content.trim()) {
    const error = new Error('The AI provider returned an empty response.')
    error.status = 502
    throw error
  }

  return {
    content,
    model: typeof data.model === 'string' ? data.model : config.model,
    usage: {
      promptTokens: Number.isFinite(data.usage?.prompt_tokens) ? data.usage.prompt_tokens : null,
      completionTokens: Number.isFinite(data.usage?.completion_tokens) ? data.usage.completion_tokens : null,
      totalTokens: Number.isFinite(data.usage?.total_tokens) ? data.usage.total_tokens : null,
    },
  }
}

function parseEvaluation(text) {
  const unwrapped = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  let value
  try {
    value = JSON.parse(unwrapped)
  } catch {
    const error = new Error('The AI returned an unreadable evaluation. Please try again.')
    error.status = 502
    throw error
  }

  if (
    !value ||
    typeof value !== 'object' ||
    !Number.isFinite(value.score) ||
    value.score < 0 ||
    value.score > 100 ||
    !Array.isArray(value.strengths) ||
    !Array.isArray(value.improvements) ||
    !Array.isArray(value.criteria)
  ) {
    const error = new Error('The AI returned an evaluation in an unexpected format. Please try again.')
    error.status = 502
    throw error
  }

  const strings = (items) =>
    items.filter((item) => typeof item === 'string').slice(0, 8).map((item) => item.slice(0, 500))
  const criteria = value.criteria
    .filter(
      (item) =>
        item &&
        typeof item.criterion === 'string' &&
        ['met', 'partial', 'missing'].includes(item.status) &&
        typeof item.reason === 'string',
    )
    .slice(0, 12)
    .map((item) => ({
      criterion: item.criterion.slice(0, 240),
      status: item.status,
      reason: item.reason.slice(0, 500),
    }))

  return {
    score: Math.round(value.score),
    summary: typeof value.summary === 'string' ? value.summary.slice(0, 1000) : '',
    strengths: strings(value.strengths),
    improvements: strings(value.improvements),
    criteria,
  }
}

async function serveStatic(request, response, vite, distDirectory) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    sendJson(response, 404, { error: 'Not found.' })
    return
  }

  if (vite) {
    vite.middlewares(request, response, () => {
      if (!response.headersSent) sendJson(response, 404, { error: 'Not found.' })
    })
    return
  }

  let pathname
  try {
    pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
  } catch {
    sendJson(response, 400, { error: 'Invalid URL.' })
    return
  }

  const requestedFile = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  let filePath = resolve(distDirectory, requestedFile)
  if (!filePath.startsWith(`${distDirectory}${sep}`) && filePath !== distDirectory) {
    sendJson(response, 403, { error: 'Forbidden.' })
    return
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    if (extname(pathname)) {
      sendJson(response, 404, { error: 'Not found.' })
      return
    }
    filePath = resolve(distDirectory, 'index.html')
  }

  response.writeHead(200, {
    'content-type': mimeTypes.get(extname(filePath)) ?? 'application/octet-stream',
    'cache-control': filePath.includes(`${sep}assets${sep}`)
      ? 'public, max-age=31536000, immutable'
      : 'no-cache',
    'x-content-type-options': 'nosniff',
  })
  if (request.method === 'HEAD') {
    response.end()
    return
  }
  response.end(readFileSync(filePath))
}

export async function createPromptOsServer({
  config = {},
  fetchImpl = fetch,
  sendEmail,
  logger = console,
  useVite = false,
  distDirectory = resolve(projectRoot, 'dist'),
  databasePath = resolve(projectRoot, '.data', 'promptos.sqlite'),
} = {}) {
  const maxTokens = Number(config.maxTokens)
  const timeoutMs = Number(config.timeoutMs)
  const providerConfig = {
    apiKey: config.apiKey ?? '',
    baseUrl: config.baseUrl ?? defaultBaseUrl,
    model: config.model ?? 'gpt-4o-mini',
    maxTokens: Number.isFinite(maxTokens) ? Math.min(8192, Math.max(1, Math.floor(maxTokens))) : 2000,
    timeoutMs: Number.isFinite(timeoutMs) ? Math.min(120_000, Math.max(1000, Math.floor(timeoutMs))) : 60_000,
  }
  const sessionSecret = config.sessionSecret ?? randomBytes(32).toString('hex')
  const inviteCode = config.inviteCode ?? randomBytes(24).toString('base64url')
  const adminInviteCode = config.adminInviteCode ?? randomBytes(24).toString('base64url')
  if (Buffer.byteLength(sessionSecret) < 32) {
    throw new Error('SESSION_SECRET must contain at least 32 bytes.')
  }
  if (Buffer.byteLength(inviteCode) < 12) {
    throw new Error('SIGNUP_INVITE_CODE must contain at least 12 bytes.')
  }
  if (Buffer.byteLength(adminInviteCode) < 12) {
    throw new Error('ADMIN_SETUP_CODE must contain at least 12 bytes.')
  }
  if (useVite && !config.inviteCode) {
    logger.warn(`PromptOS development invite code: ${inviteCode}`)
  }
  if (useVite && !config.adminInviteCode) {
    logger.warn(`PromptOS development administrator setup code: ${adminInviteCode}`)
  }
  const dailyLimitValue = Number(config.dailyLimit)
  const dailyLimit = Number.isFinite(dailyLimitValue)
    ? Math.min(1000, Math.max(1, Math.floor(dailyLimitValue)))
    : 20
  const adminEmail = typeof config.adminEmail === 'string' ? config.adminEmail.trim().toLowerCase() : ''
  const appUrl = config.appUrl ?? process.env.RENDER_EXTERNAL_URL ?? `http://127.0.0.1:${process.env.PORT || 3000}`
  const emailSender =
    sendEmail ??
    createResendEmailSender({
      apiKey: config.resendApiKey ?? '',
      from: config.emailFrom ?? '',
    })
  const secureCookies = config.secureCookies ?? process.env.NODE_ENV === 'production'
  const trustProxy = config.trustProxy === true
  const securityStore = createSecurityStore(databasePath, sessionSecret)
  const clientAddress = (request) => {
    if (trustProxy) {
      const forwarded = request.headers['x-forwarded-for']
      if (typeof forwarded === 'string' && forwarded.length <= 512) {
        const candidates = forwarded.split(',').map((value) => value.trim()).filter(Boolean)
        const candidate = candidates.at(-1)
        if (candidate) return candidate
      }
    }
    return request.socket.remoteAddress ?? 'unknown'
  }
  const allowRequest = (scope, request, windowMs, limit) =>
    securityStore.consumeRateLimit({
      scope,
      address: clientAddress(request),
      windowMs,
      limit,
    })
  const addressOf = clientAddress
  const makeEmailAction = ({ action, token }) => {
    const link = new URL('/login', appUrl)
    link.searchParams.set(action, token)
    return link.toString()
  }
  const sendVerificationEmail = async (user) => {
    const token = securityStore.createEmailToken(user.id, 'verify_email', 24 * 60 * 60 * 1000)
    await emailSender({
      to: user.email,
      subject: 'Verify your PromptOS email',
      text: `Verify your email to access PromptOS:\n\n${makeEmailAction({ action: 'verify', token })}\n\nThis link expires in 24 hours. If you did not create this account, ignore this email.`,
    })
  }
  const currentUserFor = (request) => {
    const token = readCookie(request, sessionCookieName)
    return token ? securityStore.getSession(token) : null
  }
  const recordEvent = (request, type, outcome, userId = null) => {
    securityStore.recordSecurityEvent({
      userId,
      type,
      outcome,
      address: addressOf(request),
    })
  }
  const quotaFor = (userId) => {
    const usage = securityStore.getDailyUsage(userId)
    return {
      limit: dailyLimit,
      used: usage.total ?? 0,
      runs: usage.runs ?? 0,
      evaluations: usage.evaluations ?? 0,
      remaining: Math.max(0, dailyLimit - (usage.total ?? 0)),
      resetsAt: (() => {
        const nextDay = new Date()
        nextDay.setUTCHours(24, 0, 0, 0)
        return nextDay.toISOString()
      })(),
    }
  }
  let vite = null

  const server = createHttpServer(async (request, response) => {
    response.setHeader('x-content-type-options', 'nosniff')
    response.setHeader('x-frame-options', 'DENY')
    response.setHeader('referrer-policy', 'strict-origin-when-cross-origin')
    response.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()')
    if (secureCookies) response.setHeader('strict-transport-security', 'max-age=31536000')
    const url = new URL(request.url ?? '/', 'http://localhost')
    try {
      if (url.pathname === '/api/health' && request.method === 'GET') {
        sendJson(response, 200, {
          authRequired: true,
          configured: Boolean(providerConfig.apiKey),
          provider: 'OpenAI-compatible',
          model: providerConfig.model,
        })
        return
      }

      const isAuthEndpoint = [
        '/api/auth/me',
        '/api/auth/register',
        '/api/auth/login',
        '/api/auth/logout',
        '/api/auth/verify-email',
        '/api/auth/resend-verification',
        '/api/auth/forgot-password',
        '/api/auth/reset-password',
      ].includes(url.pathname)
      if (url.pathname.startsWith('/api/') && !isAuthEndpoint && !['/api/chat', '/api/evaluate', '/api/admin/overview'].includes(url.pathname)) {
        sendJson(response, 404, { error: 'API endpoint not found.' })
        return
      }

      if (url.pathname === '/api/auth/me' && request.method === 'GET') {
        const user = currentUserFor(request)
        if (!user || user.disabled_at || !user.email_verified_at) {
          sendJson(response, 200, { user: null, quota: null, aiConfigured: Boolean(providerConfig.apiKey) })
          return
        }
        const today = quotaFor(user.id)
        sendJson(response, 200, {
          user: { id: user.id, email: user.email, role: user.role },
          quota: today,
          aiConfigured: Boolean(providerConfig.apiKey),
        })
        return
      }

      if (isAuthEndpoint && url.pathname !== '/api/auth/me') {
        if (request.method !== 'POST') {
          sendJson(response, 405, { error: 'Use POST for this endpoint.' })
          return
        }
        ensureAllowedOrigin(request)
        const authScope = url.pathname === '/api/auth/login'
          ? 'login'
          : url.pathname === '/api/auth/register'
            ? 'registration'
            : url.pathname.replace('/api/auth/', '')
        if (!allowRequest(authScope, request, 15 * 60_000, 15)) {
          recordEvent(request, 'auth_rate_limited', 'rejected')
          sendJson(response, 429, { error: 'Too many account requests. Please wait 15 minutes and try again.' })
          return
        }

        if (url.pathname === '/api/auth/logout') {
          const token = readCookie(request, sessionCookieName)
          const user = token ? currentUserFor(request) : null
          if (token) securityStore.deleteSession(token)
          recordEvent(request, 'logout', 'success', user?.id ?? null)
          response.setHeader('set-cookie', clearSessionCookie(secureCookies))
          sendJson(response, 200, { ok: true })
          return
        }

        const body = await readJsonBody(request)
        if (url.pathname === '/api/auth/verify-email') {
          const token = requireString(body?.token, 'Verification token', 256)
          const verified = securityStore.consumeEmailToken(token, 'verify_email')
          if (!verified) {
            sendJson(response, 410, { error: 'This verification link is invalid or has expired. Request a new one.' })
            return
          }
          recordEvent(request, 'email_verified', 'success', verified.id)
          sendJson(response, 200, { ok: true, message: 'Email verified. You can sign in now.' })
          return
        }

        if (url.pathname === '/api/auth/forgot-password' || url.pathname === '/api/auth/resend-verification') {
          const email = requireString(body?.email, 'Email', 254).toLowerCase()
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            const error = new Error('Enter a valid email address.')
            error.status = 400
            throw error
          }
          const user = securityStore.getUserByEmail(email)
          const isReset = url.pathname === '/api/auth/forgot-password'
          const shouldSend = user && !user.disabled_at &&
            (isReset ? Boolean(user.email_verified_at) : !user.email_verified_at)
          if (shouldSend) {
            const purpose = isReset ? 'reset_password' : 'verify_email'
            const lifetime = isReset ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000
            const token = securityStore.createEmailToken(user.id, purpose, lifetime)
            const action = isReset ? 'reset' : 'verify'
            try {
              await emailSender({
                to: user.email,
                subject: isReset ? 'Reset your PromptOS password' : 'Verify your PromptOS email',
                text: isReset
                  ? `Reset your PromptOS password:\n\n${makeEmailAction({ action, token })}\n\nThis link expires in one hour. If you did not request a reset, ignore this email.`
                  : `Verify your email to access PromptOS:\n\n${makeEmailAction({ action, token })}\n\nThis link expires in 24 hours. If you did not create this account, ignore this email.`,
              })
            } catch (error) {
              logger.error('PromptOS could not send an account email.', error)
              if (url.pathname === '/api/auth/resend-verification') {
                sendJson(response, 503, { error: 'Could not send the verification email. Try again later.' })
                return
              }
            }
          }
          recordEvent(request, isReset ? 'password_reset_requested' : 'verification_resent', 'accepted', user?.id ?? null)
          sendJson(response, 202, {
            message: isReset
              ? 'If a verified account exists for that email, password reset instructions will be sent.'
              : 'If the account needs verification, a new verification link will be sent.',
          })
          return
        }

        if (url.pathname === '/api/auth/reset-password') {
          const token = requireString(body?.token, 'Reset token', 256)
          const password = body?.password
          if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
            const error = new Error('Password must be between 12 and 128 characters.')
            error.status = 400
            throw error
          }
          const reset = securityStore.consumeEmailToken(token, 'reset_password')
          if (!reset) {
            sendJson(response, 410, { error: 'This password reset link is invalid or has expired. Request a new one.' })
            return
          }
          await securityStore.changePassword(reset.id, password)
          recordEvent(request, 'password_reset', 'success', reset.id)
          sendJson(response, 200, { ok: true, message: 'Password updated. Sign in with your new password.' })
          return
        }

        const email = requireString(body?.email, 'Email', 254).toLowerCase()
        if (typeof body?.password !== 'string' || body.password.length > 128) {
          const error = new Error('Password is required and must be 128 characters or fewer.')
          error.status = 400
          throw error
        }
        const password = body.password
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          const error = new Error('Enter a valid email address.')
          error.status = 400
          throw error
        }
        if (password.length < 12) {
          const error = new Error('Password must be at least 12 characters.')
          error.status = 400
          throw error
        }

        if (url.pathname === '/api/auth/register') {
          const suppliedInvite = typeof body?.inviteCode === 'string' ? body.inviteCode : ''
          if (!safeEqual(suppliedInvite, inviteCode)) {
            recordEvent(request, 'signup', 'invalid_invite')
            sendJson(response, 403, { error: 'Invitation code is invalid.' })
            return
          }
          const isConfiguredAdmin = Boolean(adminEmail && email === adminEmail)
          const suppliedAdminCode = typeof body?.adminSetupCode === 'string' ? body.adminSetupCode : ''
          if (isConfiguredAdmin && !safeEqual(suppliedAdminCode, adminInviteCode)) {
            recordEvent(request, 'signup', 'invalid_admin_setup_code')
            sendJson(response, 403, { error: 'Invitation details are invalid.' })
            return
          }
          const created = await securityStore.createUser(
            email,
            password,
            isConfiguredAdmin ? 'admin' : 'user',
            !adminEmail,
          )
          if (!created) {
            recordEvent(request, 'signup', 'duplicate_account')
            sendJson(response, 409, { error: 'An account with that email already exists.' })
            return
          }
          recordEvent(request, 'signup', 'pending_verification', created.id)
          try {
            await sendVerificationEmail(created)
          } catch (error) {
            logger.error('PromptOS could not send a verification email.', error)
            sendJson(response, 503, { error: 'Your account was created, but the verification email could not be sent. Use Resend verification to try again.' })
            return
          }
          sendJson(response, 202, { message: 'Account created. Check your email for a verification link before signing in.' })
          return
        }

        const user = securityStore.getUserByEmail(email)
        const validPassword = await securityStore.verifyPassword(user, password)
        if (!user || !validPassword) {
          recordEvent(request, 'login', 'invalid_credentials', user?.id ?? null)
          sendJson(response, 401, { error: 'Email or password is incorrect.' })
          return
        }
        if (!user.email_verified_at) {
          sendJson(response, 403, { error: 'Verify your email before signing in. You can request a new verification link.' })
          return
        }
        recordEvent(request, 'login', 'success', user.id)
        const session = securityStore.createSession(user.id)
        response.setHeader('set-cookie', sessionCookie(session.token, sessionLifetimeSeconds, secureCookies))
        sendJson(response, 200, {
          user: { id: user.id, email: user.email, role: user.role },
          quota: quotaFor(user.id),
          aiConfigured: Boolean(providerConfig.apiKey),
        })
        return
      }

      if (url.pathname === '/api/admin/overview' && request.method === 'GET') {
        const user = currentUserFor(request)
        if (!user || user.disabled_at || !user.email_verified_at) {
          sendJson(response, 401, { error: 'Sign in to continue.' })
          return
        }
        if (user.role !== 'admin') {
          sendJson(response, 403, { error: 'Administrator access is required.' })
          return
        }
        sendJson(response, 200, {
          activeUsers: securityStore.getActiveUserCount(),
          recentEvents: securityStore.getRecentEvents(50),
          recentUsage: securityStore.getRecentUsage(50),
          dailyLimit,
        })
        return
      }

      if (url.pathname === '/api/chat' || url.pathname === '/api/evaluate') {
        if (request.method !== 'POST') {
          sendJson(response, 405, { error: 'Use POST for this endpoint.' })
          return
        }
        ensureAllowedOrigin(request)
        if (!allowRequest('ai', request, rateLimitWindowMs, rateLimitRequests)) {
          recordEvent(request, 'ai_rate_limited', 'rejected')
          sendJson(response, 429, { error: 'Too many AI requests. Please wait a minute and try again.' })
          return
        }
        const user = currentUserFor(request)
        if (!user || user.disabled_at || !user.email_verified_at) {
          recordEvent(request, 'unauthorized_ai_request', 'rejected')
          sendJson(response, 401, { error: 'Sign in to use AI features.' })
          return
        }

        const body = await readJsonBody(request)
        const isEvaluation = url.pathname === '/api/evaluate'
        const prompt = requireString(body?.prompt, 'Prompt', 90_000)
        const userInput = isEvaluation
          ? requireString(body?.answer, 'AI response', 50_000)
          : requireString(body?.input, 'User message', 30_000)
        const usageStart = securityStore.startAiUsage(user.id, isEvaluation ? 'evaluation' : 'run', dailyLimit)
        if (!usageStart.allowed) {
          recordEvent(request, 'daily_ai_quota_exceeded', 'rejected', user.id)
          sendJson(response, 429, {
            error: `Daily AI request limit reached (${dailyLimit}). Try again after the quota resets.`,
            quota: quotaFor(user.id),
          })
          return
        }

        const startedAt = Date.now()
        try {
          const result = await callProvider({
            config: providerConfig,
            fetchImpl,
            system: isEvaluation
              ? [
                  'You are a rigorous but fair evaluator of AI responses against user instructions.',
                  'Evaluate only the supplied prompt and response. Do not claim factual verification you did not perform.',
                  'Return only valid JSON with this exact shape:',
                  '{"score":0,"summary":"...","strengths":["..."],"improvements":["..."],"criteria":[{"criterion":"...","status":"met|partial|missing","reason":"..."}]}',
                  'Use a 0-100 score. List concise, evidence-based points. Include up to 8 strengths, 8 improvements, and 12 criteria.',
                ].join('\n')
              : prompt,
            user: isEvaluation
              ? `PROMPT:\n${prompt}\n\nRESPONSE TO EVALUATE:\n${userInput}`
              : userInput,
          })
          const durationMs = Date.now() - startedAt
          if (isEvaluation) {
            const evaluation = parseEvaluation(result.content)
            securityStore.finishAiUsage(usageStart.id, {
              status: 'success',
              durationMs,
              usage: result.usage,
              model: result.model,
            })
            recordEvent(request, 'ai_evaluation', 'success', user.id)
            sendJson(response, 200, { ...evaluation, usage: result.usage, durationMs, quota: quotaFor(user.id) })
            return
          }

          securityStore.finishAiUsage(usageStart.id, {
            status: 'success',
            durationMs,
            usage: result.usage,
            model: result.model,
          })
          recordEvent(request, 'ai_run', 'success', user.id)
          sendJson(response, 200, { ...result, durationMs, quota: quotaFor(user.id) })
        } catch (error) {
          securityStore.finishAiUsage(usageStart.id, {
            status: 'failed',
            durationMs: Date.now() - startedAt,
          })
          recordEvent(request, isEvaluation ? 'ai_evaluation' : 'ai_run', 'failed', user.id)
          if (error && typeof error === 'object') error.quota = quotaFor(user.id)
          throw error
        }
        return
      }

      if (url.pathname.startsWith('/api/')) {
        sendJson(response, 404, { error: 'API endpoint not found.' })
        return
      }
      await serveStatic(request, response, vite, distDirectory)
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 500
      if (status >= 500) logger.error('PromptOS request failed.', error)
      const body = {
        error: Number.isInteger(error?.status) ? error.message : 'The server could not process this request.',
      }
      if (error?.quota) body.quota = error.quota
      sendJson(response, status, body)
    }
  })

  if (useVite) {
    vite = await createViteServer({
      configFile: resolve(projectRoot, 'vite.config.ts'),
      root: projectRoot,
      server: { middlewareMode: true, hmr: { server } },
      appType: 'spa',
    })
  }

  server.on('close', () => {
    void vite?.close()
    securityStore.close()
  })
  return server
}

async function start() {
  const envPath = resolve(projectRoot, '.env')
  if (existsSync(envPath)) process.loadEnvFile(envPath)

  const useVite = process.env.NODE_ENV !== 'production'
  if (!useVite) {
    if (!process.env.SESSION_SECRET || Buffer.byteLength(process.env.SESSION_SECRET) < 32) {
      throw new Error('Set SESSION_SECRET to a random value with at least 32 bytes before production start.')
    }
    if (!process.env.SIGNUP_INVITE_CODE || Buffer.byteLength(process.env.SIGNUP_INVITE_CODE) < 12) {
      throw new Error('Set SIGNUP_INVITE_CODE to a private value with at least 12 bytes before production start.')
    }
    if (!process.env.ADMIN_SETUP_CODE || Buffer.byteLength(process.env.ADMIN_SETUP_CODE) < 12) {
      throw new Error('Set ADMIN_SETUP_CODE to a separate private value with at least 12 bytes before production start.')
    }
    if (!process.env.ADMIN_EMAIL) {
      throw new Error('Set ADMIN_EMAIL to the administrator account email before production start.')
    }
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('Set OPENAI_API_KEY in the production environment before starting PromptOS.')
    }
    if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
      throw new Error('Set RESEND_API_KEY and EMAIL_FROM to enable account verification and password recovery.')
    }
    const publicUrl = process.env.APP_URL || process.env.RENDER_EXTERNAL_URL
    if (!publicUrl || new URL(publicUrl).protocol !== 'https:') {
      throw new Error('Set APP_URL to the public HTTPS address before production start.')
    }
  }
  if (useVite) {
    process.env.SESSION_SECRET ||= randomBytes(32).toString('hex')
    if (!process.env.SIGNUP_INVITE_CODE) {
      process.env.SIGNUP_INVITE_CODE = randomBytes(24).toString('base64url')
      console.warn(`PromptOS development invite code: ${process.env.SIGNUP_INVITE_CODE}`)
    }
    if (!process.env.ADMIN_SETUP_CODE) {
      process.env.ADMIN_SETUP_CODE = randomBytes(24).toString('base64url')
      console.warn(`PromptOS development administrator setup code: ${process.env.ADMIN_SETUP_CODE}`)
    }
  }
  const useDevelopmentEmail = useVite && (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM)
  const sendEmail = useDevelopmentEmail
    ? async ({ to, subject, text }) => {
        console.info('PromptOS development email (local only).', { to, subject, text })
      }
    : undefined
  const server = await createPromptOsServer({
    config: {
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl: process.env.OPENAI_BASE_URL,
      model: process.env.OPENAI_MODEL,
      maxTokens: Number(process.env.OPENAI_MAX_TOKENS) || undefined,
      timeoutMs: Number(process.env.AI_TIMEOUT_MS) || undefined,
      sessionSecret: process.env.SESSION_SECRET,
      inviteCode: process.env.SIGNUP_INVITE_CODE,
      adminInviteCode: process.env.ADMIN_SETUP_CODE,
      adminEmail: process.env.ADMIN_EMAIL,
      appUrl: process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || `http://127.0.0.1:${process.env.PORT || 3000}`,
      resendApiKey: process.env.RESEND_API_KEY,
      emailFrom: process.env.EMAIL_FROM,
      dailyLimit: Number(process.env.AI_DAILY_LIMIT) || undefined,
      secureCookies: process.env.NODE_ENV === 'production',
      trustProxy: process.env.TRUST_PROXY === 'true',
    },
    useVite,
    sendEmail,
    databasePath: process.env.DATABASE_PATH
      ? resolve(projectRoot, process.env.DATABASE_PATH)
      : undefined,
  })
  const port = Number(process.env.PORT) || 3000
  const host = process.env.HOST || (useVite ? '127.0.0.1' : '0.0.0.0')
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, resolve)
  })
  console.log(`PromptOS ${useVite ? 'development' : 'production'} server listening on http://${host}:${port}`)
  if (!process.env.OPENAI_API_KEY) {
    console.log('AI is not configured. Copy .env.example to .env and add an API key to enable execution.')
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  start().catch((error) => {
    console.error('PromptOS server failed to start.', error)
    process.exitCode = 1
  })
}
