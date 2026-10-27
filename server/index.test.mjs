import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import Database from 'better-sqlite3'
import { createPromptOsServer } from './index.mjs'
import { createBrevoEmailSender, createResendEmailSender } from './email.mjs'
import { createSecurityStore } from './securityStore.mjs'
import vercelHandler from '../api/[...route].mjs'

const activeServers = new Set()

afterEach(async () => {
  await Promise.all(
    [...activeServers].map(
      (server) =>
        new Promise((resolve, reject) => {
          server.close((error) => {
            activeServers.delete(server)
            if (error) reject(error)
            else resolve()
          })
        }),
    ),
  )
})

async function startServer(options = {}) {
  const sentEmails = []
  const server = await createPromptOsServer({
    ...options,
    sendEmail: options.sendEmail ?? (async (message) => sentEmails.push(message)),
    config: {
      apiKey: 'test-provider-key',
      sessionSecret: 'test-session-secret-that-is-at-least-32-bytes',
      dailyLimit: 100,
      appUrl: 'https://promptos.example.test',
      ...options.config,
    },
    databasePath: options.databasePath ?? ':memory:',
  })
  activeServers.add(server)
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  const baseUrl = `http://127.0.0.1:${address.port}`
  return {
    server,
    baseUrl,
    sentEmails,
    async register(email = 'member@example.com', registration = {}) {
      const response = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email,
          password: 'test-password-at-least-12',
          acceptedTerms: true,
          ...registration,
        }),
      })
      const registrationBody = await response.json()
      if (!response.ok) return { response, body: registrationBody, cookie: null }
      const verificationUrl = new URL(sentEmails.at(-1).text.match(/https?:\/\/\S+/)[0])
      const verificationResponse = await fetch(`${baseUrl}/api/auth/verify-email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: verificationUrl.searchParams.get('verify') }),
      })
      const login = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'test-password-at-least-12' }),
      })
      const body = await login.json()
      const cookie = login.headers.get('set-cookie')?.split(';')[0]
      return { response, body, cookie, registrationBody, verificationResponse }
    },
  }
}

function providerResponse(content, extra = {}) {
  return new Response(
    JSON.stringify({
      model: 'test-model',
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 12, completion_tokens: 34, total_tokens: 46 },
      ...extra,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

test('health reports whether the provider is configured without exposing its API key', async () => {
  const { baseUrl } = await startServer({
    config: { apiKey: 'secret-test-key', model: 'test-model' },
  })
  const response = await fetch(`${baseUrl}/api/health`)
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.deepEqual(body, {
    authRequired: true,
    configured: true,
    provider: 'OpenAI-compatible',
    model: 'test-model',
  })
  assert.equal(JSON.stringify(body).includes('secret-test-key'), false)
})

test('Vercel handler returns an explicit configuration error when the database is missing', async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL
  const previousConsoleError = console.error
  delete process.env.DATABASE_URL
  console.error = () => {}
  const response = {
    headers: {},
    status: null,
    body: '',
    writeHead(status, headers) {
      this.status = status
      this.headers = headers
    },
    end(body) {
      this.body = body
    },
  }

  try {
    await vercelHandler({}, response)
  } finally {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = previousDatabaseUrl
    console.error = previousConsoleError
  }

  assert.equal(response.status, 503)
  assert.equal(response.headers['content-type'], 'application/json; charset=utf-8')
  assert.deepEqual(JSON.parse(response.body), {
    error: 'PromptOS is not fully configured. Check the deployment environment variables.',
  })
})

test('Vercel serves API functions before falling back to the SPA document', () => {
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))

  assert.deepEqual(config.routes[0], { src: '/api/(.*)', dest: '/api/[...route]' })
  assert.deepEqual(config.routes[1], { handle: 'filesystem' })
  assert.deepEqual(config.routes[2], { src: '/(.*)', dest: '/index.html' })
})

test('chat sends prompts through the server credential and returns usage metadata', async () => {
  let captured
  const { baseUrl, register } = await startServer({
    config: { apiKey: 'secret-test-key', model: 'test-model', maxTokens: 321 },
    fetchImpl: async (url, options) => {
      captured = { url: String(url), options, body: JSON.parse(options.body) }
      return providerResponse('AI answer')
    },
  })
  const account = await register()
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: account.cookie },
    body: JSON.stringify({ prompt: 'Act as a reviewer.', input: 'Review this change.' }),
  })
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.content, 'AI answer')
  assert.equal(body.model, 'test-model')
  assert.deepEqual(body.usage, { promptTokens: 12, completionTokens: 34, totalTokens: 46 })
  assert.equal(captured.url, 'https://api.openai.com/v1/chat/completions')
  assert.equal(captured.options.headers.authorization, 'Bearer secret-test-key')
  assert.equal(captured.body.max_tokens, 321)
  assert.deepEqual(captured.body.messages, [
    { role: 'system', content: 'Act as a reviewer.' },
    { role: 'user', content: 'Review this change.' },
  ])
})

test('evaluation validates and returns the provider evaluation', async () => {
  const evaluation = {
    score: 88,
    summary: 'Mostly follows the prompt.',
    strengths: ['Includes requested sections.'],
    improvements: ['Add test evidence.'],
    criteria: [{ criterion: 'Include tests', status: 'partial', reason: 'A plan is given, but no test result.' }],
  }
  const { baseUrl, register } = await startServer({
    config: { apiKey: 'test-key' },
    fetchImpl: async () => providerResponse(JSON.stringify(evaluation)),
  })
  const account = await register()
  const response = await fetch(`${baseUrl}/api/evaluate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: account.cookie },
    body: JSON.stringify({ prompt: 'Add tests.', answer: 'Here is a test plan.' }),
  })

  assert.equal(response.status, 200)
  const body = await response.json()
  assert.deepEqual(
    {
      score: body.score,
      summary: body.summary,
      strengths: body.strengths,
      improvements: body.improvements,
      criteria: body.criteria,
    },
    evaluation,
  )
  assert.deepEqual(body.usage, { promptTokens: 12, completionTokens: 34, totalTokens: 46 })
  assert.equal(Number.isFinite(body.durationMs), true)
})

test('missing server API key fails clearly without contacting the provider', async () => {
  let providerCalled = false
  const { baseUrl, register } = await startServer({
    config: { apiKey: '' },
    fetchImpl: async () => {
      providerCalled = true
      return providerResponse('unreachable')
    },
    logger: { error() {} },
  })
  const account = await register()
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: account.cookie },
    body: JSON.stringify({ prompt: 'Prompt', input: 'Run it.' }),
  })
  const body = await response.json()

  assert.equal(response.status, 503)
  assert.match(body.error, /OPENAI_API_KEY/)
  assert.equal(body.quota.used, 1)
  assert.equal(body.quota.remaining, 99)
  assert.equal(providerCalled, false)
})

test('invalid request bodies and cross-origin requests are rejected', async () => {
  const { baseUrl, register } = await startServer({ config: { apiKey: 'test-key' } })
  const account = await register()
  const missingFields = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: account.cookie },
    body: JSON.stringify({ prompt: 'Only a prompt' }),
  })
  const crossOrigin = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://attacker.example',
      cookie: account.cookie,
    },
    body: JSON.stringify({ prompt: 'Prompt', input: 'Input' }),
  })

  assert.equal(missingFields.status, 400)
  assert.equal(crossOrigin.status, 403)
})

test('provider errors do not leak upstream response details', async () => {
  const { baseUrl, register } = await startServer({
    config: { apiKey: 'test-key' },
    fetchImpl: async () => new Response('secret upstream diagnostic', { status: 401 }),
    logger: { error() {} },
  })
  const account = await register()
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: account.cookie },
    body: JSON.stringify({ prompt: 'Prompt', input: 'Input' }),
  })
  const body = await response.json()

  assert.equal(response.status, 502)
  assert.match(body.error, /HTTP 401/)
  assert.equal(body.quota.used, 1)
  assert.equal(JSON.stringify(body).includes('secret upstream diagnostic'), false)
})

test('AI endpoints require an authenticated session', async () => {
  const { baseUrl } = await startServer()
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: 'Prompt', input: 'Run this.' }),
  })

  assert.equal(response.status, 401)
})

test('public registration requires email verification and only configured admin gets admin access', async () => {
  const { baseUrl, register } = await startServer({ config: { adminEmail: 'admin@example.com' } })
  const first = await register('admin@example.com')
  const second = await register('member@example.com')
  const adminView = await fetch(`${baseUrl}/api/admin/overview`, { headers: { cookie: first.cookie } })
  const memberView = await fetch(`${baseUrl}/api/admin/overview`, { headers: { cookie: second.cookie } })

  assert.equal(first.response.status, 202)
  assert.equal(first.body.user.role, 'admin')
  assert.equal(second.body.user.role, 'user')
  assert.equal(first.verificationResponse.status, 200)
  assert.equal(adminView.status, 200)
  assert.equal(memberView.status, 403)
})

test('configured administrator email prevents other signups from becoming administrators', async () => {
  const { register } = await startServer({ config: { adminEmail: 'owner@example.com' } })
  const first = await register('member@example.com')
  const admin = await register('owner@example.com')

  assert.equal(first.body.user.role, 'user')
  assert.equal(admin.body.user.role, 'admin')
})

test('configured administrator can register publicly and must verify email', async () => {
  const { register } = await startServer({ config: { adminEmail: 'owner@example.com' } })
  const owner = await register('owner@example.com')

  assert.equal(owner.response.status, 202)
  assert.equal(owner.body.user.role, 'admin')
  assert.equal(owner.verificationResponse.status, 200)
})

test('login uses secure session cookies and logout revokes the session', async () => {
  const { baseUrl, register } = await startServer()
  const account = await register()
  const badLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'member@example.com', password: 'incorrect-password' }),
  })
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'member@example.com', password: 'test-password-at-least-12' }),
  })
  const cookie = login.headers.get('set-cookie')?.split(';')[0]
  const logout = await fetch(`${baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: account.cookie },
    body: JSON.stringify({}),
  })
  const oldSession = await fetch(`${baseUrl}/api/auth/me`, { headers: { cookie: account.cookie } })

  assert.equal(badLogin.status, 401)
  assert.equal(login.status, 200)
  assert.equal((await login.json()).user.email, 'member@example.com')
  assert.match(login.headers.get('set-cookie'), /HttpOnly/)
  assert.equal(logout.status, 200)
  assert.equal(oldSession.status, 200)
  assert.equal((await oldSession.json()).user, null)
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/)
  assert.ok(cookie)
})

test('production session cookies include Secure', async () => {
  const { register } = await startServer({ config: { secureCookies: true } })
  const account = await register()

  assert.equal(account.verificationResponse.status, 200)
  assert.match(account.cookie, /promptos_session=/)
})

test('AI run and evaluation quotas are enforced and visible to the account owner', async () => {
  let providerCalls = 0
  const { baseUrl, register } = await startServer({
    config: { dailyLimit: 1 },
    fetchImpl: async () => {
      providerCalls += 1
      return providerResponse('A valid answer.')
    },
  })
  const account = await register()
  const headers = { 'content-type': 'application/json', cookie: account.cookie }
  const run = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ prompt: 'Prompt', input: 'Run this.' }),
  })
  const result = await run.json()
  const evaluation = await fetch(`${baseUrl}/api/evaluate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ prompt: 'Prompt', answer: 'Answer.' }),
  })
  const quota = await fetch(`${baseUrl}/api/auth/me`, { headers: { cookie: account.cookie } })

  assert.equal(run.status, 200)
  assert.equal(result.quota.limit, 1)
  assert.equal(result.quota.used, 1)
  assert.equal(result.quota.runs, 1)
  assert.equal(result.quota.evaluations, 0)
  assert.equal(result.quota.remaining, 0)
  assert.equal(evaluation.status, 429)
  assert.equal(providerCalls, 1)
  assert.equal((await quota.json()).quota.remaining, 0)
})

test('AI endpoint rate limits are enforced per IP', async () => {
  const { baseUrl, register } = await startServer()
  const account = await register()
  const request = () =>
    fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: account.cookie },
      body: JSON.stringify({}),
    })

  for (let attempt = 0; attempt < 30; attempt += 1) {
    assert.equal((await request()).status, 400)
  }
  assert.equal((await request()).status, 429)
})

test('registration requires email verification before a session or AI access is granted', async () => {
  const { baseUrl, sentEmails } = await startServer()
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'unverified@example.com',
      password: 'test-password-at-least-12',
      acceptedTerms: true,
    }),
  })
  const body = await response.json()
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'unverified@example.com', password: 'test-password-at-least-12' }),
  })
  const ai = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: 'Prompt', input: 'Run' }),
  })

  assert.equal(response.status, 202)
  assert.equal(body.user, undefined)
  assert.equal(response.headers.get('set-cookie'), null)
  assert.match(sentEmails[0].text, /verify=/)
  assert.equal(login.status, 403)
  assert.equal(ai.status, 401)
})

test('registration validates email, password, and explicit policy acceptance', async () => {
  const { baseUrl } = await startServer()
  const register = (body) =>
    fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

  assert.equal((await register({ email: 'not-an-email', password: 'test-password-at-least-12', acceptedTerms: true })).status, 400)
  assert.equal((await register({ email: 'valid@example.test', password: 'short', acceptedTerms: true })).status, 400)
  const missingConsent = await register({ email: 'valid@example.test', password: 'test-password-at-least-12' })
  assert.equal(missingConsent.status, 400)
  assert.match((await missingConsent.json()).error, /Terms of Use and Privacy Policy/)
})

test('duplicate registration does not disclose whether an account exists', async () => {
  const { baseUrl, register } = await startServer()
  const first = await register('private@example.test')
  const duplicate = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'private@example.test',
      password: 'test-password-at-least-12',
      acceptedTerms: true,
    }),
  })

  assert.equal(first.response.status, 202)
  assert.equal(duplicate.status, 202)
  assert.deepEqual(await duplicate.json(), first.registrationBody)
})

test('verification send failure is explicit, safely logged, and recoverable by resend', async () => {
  const messages = []
  const logs = []
  let sendAttempts = 0
  const { baseUrl } = await startServer({
    sendEmail: async (message) => {
      sendAttempts += 1
      if (sendAttempts === 1) {
        const error = new Error('private@example.test token=secret-verification-token')
        error.code = 'EMAIL_SENDER_DOMAIN_UNVERIFIED'
        error.providerStatus = 403
        error.providerCode = 'validation_error'
        throw error
      }
      messages.push(message)
    },
    logger: { error: (...args) => logs.push(args) },
  })
  const registration = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'private@example.test',
      password: 'test-password-at-least-12',
      acceptedTerms: true,
    }),
  })
  const failureBody = await registration.json()
  const pendingLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'private@example.test', password: 'test-password-at-least-12' }),
  })
  const retry = await fetch(`${baseUrl}/api/auth/resend-verification`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'private@example.test' }),
  })

  assert.equal(registration.status, 503)
  assert.equal(failureBody.code, 'EMAIL_SENDER_DOMAIN_UNVERIFIED')
  assert.match(failureBody.error, /account was created/i)
  assert.match(failureBody.error, /domain is not verified/i)
  assert.equal(pendingLogin.status, 403)
  assert.equal(retry.status, 202)
  assert.equal(messages.length, 1)
  assert.equal(logs[0][1].code, 'EMAIL_SENDER_DOMAIN_UNVERIFIED')
  assert.equal(logs[0][1].providerStatus, 403)
  assert.doesNotMatch(JSON.stringify(logs), /private@example\.test|secret-verification-token/)

  const verificationUrl = new URL(messages[0].text.match(/https?:\/\/\S+/)[0])
  const verified = await fetch(`${baseUrl}/api/auth/verify-email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: verificationUrl.searchParams.get('verify') }),
  })
  assert.equal(verified.status, 200)
})

test('verification email requests are rate limited per email address', async () => {
  const { baseUrl, register } = await startServer()
  await register('limited@example.test')
  const resend = () =>
    fetch(`${baseUrl}/api/auth/resend-verification`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'limited@example.test' }),
    })

  assert.equal((await resend()).status, 202)
  assert.equal((await resend()).status, 202)
  const limited = await resend()
  assert.equal(limited.status, 429)
  assert.match((await limited.json()).error, /Too many email requests/)
})

test('email verification tokens are single-use and reset password revokes prior sessions', async () => {
  const { baseUrl, register, sentEmails } = await startServer()
  const account = await register()
  const forgot = await fetch(`${baseUrl}/api/auth/forgot-password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'member@example.com' }),
  })
  const resetUrl = new URL(sentEmails.at(-1).text.match(/https?:\/\/\S+/)[0])
  const token = resetUrl.searchParams.get('reset')
  const reset = await fetch(`${baseUrl}/api/auth/reset-password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, password: 'a-new-password-123' }),
  })
  const reused = await fetch(`${baseUrl}/api/auth/reset-password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, password: 'another-new-password-123' }),
  })
  const oldSession = await fetch(`${baseUrl}/api/auth/me`, { headers: { cookie: account.cookie } })
  const oldPasswordLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'member@example.com', password: 'test-password-at-least-12' }),
  })
  const newPasswordLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'member@example.com', password: 'a-new-password-123' }),
  })

  assert.equal(forgot.status, 202)
  assert.equal(reset.status, 200)
  assert.equal(reused.status, 410)
  assert.equal(oldSession.status, 200)
  assert.equal((await oldSession.json()).user, null)
  assert.equal(oldPasswordLogin.status, 401)
  assert.equal(newPasswordLogin.status, 200)
})

test('forgot-password response does not disclose whether an account exists', async () => {
  const { baseUrl } = await startServer()
  const request = (email) =>
    fetch(`${baseUrl}/api/auth/forgot-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    })
  const existing = await request('existing@example.com')
  const missing = await request('missing@example.com')

  assert.equal(existing.status, 202)
  assert.equal(missing.status, 202)
  assert.deepEqual(await existing.json(), await missing.json())
})

test('IP rate-limit counters persist across server-store restarts', (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'promptos-rate-limit-'))
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const databasePath = join(directory, 'security.sqlite')
  const secret = 'persistent-rate-limit-test-secret-32-bytes'
  const options = {
    scope: 'login',
    address: '203.0.113.10',
    windowMs: 60_000,
    limit: 1,
  }

  const firstStore = createSecurityStore(databasePath, secret)
  assert.equal(firstStore.consumeRateLimit(options), true)
  firstStore.close()

  const restartedStore = createSecurityStore(databasePath, secret)
  assert.equal(restartedStore.consumeRateLimit(options), false)
  restartedStore.close()
})

test('existing databases gain the email-verification field without dropping accounts', (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'promptos-schema-migration-'))
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const databasePath = join(directory, 'legacy.sqlite')
  const legacyDatabase = new Database(databasePath)
  legacyDatabase.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_salt BLOB NOT NULL,
      password_hash BLOB NOT NULL,
      created_at INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      disabled_at INTEGER
    );
    INSERT INTO users (id, email, password_salt, password_hash, created_at, role)
    VALUES ('legacy-user', 'legacy@example.test', X'01', X'02', 1, 'user');
  `)
  legacyDatabase.close()

  const store = createSecurityStore(databasePath, 'migration-test-secret-that-is-at-least-32-bytes')
  assert.equal(store.getUserById('legacy-user').email, 'legacy@example.test')
  assert.equal(store.getUserById('legacy-user').email_verified_at, null)
  const legacy = store.getUserByEmail('legacy@example.test')
  assert.equal(legacy.terms_accepted_at, null)
  assert.equal(legacy.terms_version, null)
  store.close()
})

test('new accounts persist the accepted terms version and timestamp', async () => {
  const store = createSecurityStore(':memory:', 'terms-test-secret-that-is-at-least-32-bytes')
  const user = await store.createUser(
    'accepted@example.test',
    'test-password-at-least-12',
    'user',
    false,
    '2026-10-27',
  )
  const saved = store.getUserByEmail('accepted@example.test')

  assert.equal(saved.id, user.id)
  assert.equal(saved.terms_version, '2026-10-27')
  assert.ok(Number.isInteger(saved.terms_accepted_at))
  store.close()
})

test('Resend email sender keeps HTML safe and does not expose provider response bodies', async () => {
  let request
  const sender = createResendEmailSender({
    apiKey: 'resend-test-secret',
    from: 'PromptOS <accounts@example.test>',
    fetchImpl: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) }
      return new Response('', { status: 200 })
    },
  })
  await sender({
    to: 'member@example.test',
    subject: 'Verify',
    text: 'Click <script>alert(1)</script>\nhttps://promptos.example.test/login?verify=token',
  })

  assert.equal(request.url, 'https://api.resend.com/emails')
  assert.equal(request.options.headers.authorization, 'Bearer resend-test-secret')
  assert.match(request.body.html, /&lt;script&gt;/)
  assert.doesNotMatch(request.body.html, /<script>/)

  const failingSender = createResendEmailSender({
    apiKey: 'resend-test-secret',
    from: 'PromptOS <accounts@example.test>',
    fetchImpl: async () => new Response('provider secret diagnostic', { status: 401 }),
  })
  await assert.rejects(
    failingSender({ to: 'member@example.test', subject: 'Verify', text: 'Body' }),
    (error) => {
      assert.match(error.message, /HTTP 401/)
      assert.equal(error.code, 'EMAIL_PROVIDER_AUTH_FAILED')
      assert.doesNotMatch(error.message, /provider secret diagnostic/)
      return true
    },
  )

  const restrictedSender = createResendEmailSender({
    apiKey: 'resend-test-secret',
    from: 'PromptOS <accounts@example.test>',
    fetchImpl: async () => new Response(JSON.stringify({
      name: 'validation_error',
      message: 'Testing domain restriction: verify a domain and update from address.',
    }), {
      status: 403,
      headers: { 'content-type': 'application/json', 'x-resend-id': 'safe-provider-request-id' },
    }),
  })
  await assert.rejects(
    restrictedSender({ to: 'member@example.test', subject: 'Verify', text: 'Body' }),
    (error) => {
      assert.equal(error.code, 'EMAIL_SENDER_DOMAIN_UNVERIFIED')
      assert.equal(error.providerStatus, 403)
      assert.equal(error.providerCode, 'validation_error')
      assert.equal(error.providerRequestId, 'safe-provider-request-id')
      assert.doesNotMatch(error.message, /verify a domain/)
      return true
    },
  )
})

test('Brevo sender uses the verified mailbox and keeps API credentials server-side', async () => {
  let request
  const sender = createBrevoEmailSender({
    apiKey: 'brevo-test-secret',
    from: 'owner@example.test',
    fetchImpl: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) }
      return new Response(JSON.stringify({ messageId: '<message@example.test>' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      })
    },
  })

  await sender({
    to: 'recipient@example.test',
    subject: 'Verify',
    text: 'Click <script>alert(1)</script>\nhttps://promptos.example.test/login?verify=token',
  })

  assert.equal(request.url, 'https://api.brevo.com/v3/smtp/email')
  assert.equal(request.options.headers['api-key'], 'brevo-test-secret')
  assert.equal(request.body.sender.name, 'PromptOS')
  assert.equal(request.body.sender.email, 'owner@example.test')
  assert.deepEqual(request.body.to, [{ email: 'recipient@example.test' }])
  assert.match(request.body.htmlContent, /&lt;script&gt;/)
  assert.doesNotMatch(request.body.htmlContent, /<script>/)
  assert.equal(JSON.stringify(request.body).includes('brevo-test-secret'), false)
})

test('Brevo sender returns a safe diagnostic when its sender has not been verified', async () => {
  const sender = createBrevoEmailSender({
    apiKey: 'brevo-test-secret',
    from: 'owner@example.test',
    fetchImpl: async () => new Response(JSON.stringify({
      code: 'sender_not_verified',
      message: 'Sender must be verified before sending.',
    }), {
      status: 400,
      headers: { 'content-type': 'application/json', 'x-sib-request-id': 'brevo-safe-request-id' },
    }),
  })

  await assert.rejects(
    sender({ to: 'recipient@example.test', subject: 'Verify', text: 'Body' }),
    (error) => {
      assert.equal(error.code, 'EMAIL_SENDER_DOMAIN_UNVERIFIED')
      assert.equal(error.providerStatus, 400)
      assert.equal(error.providerRequestId, 'brevo-safe-request-id')
      assert.doesNotMatch(error.message, /Sender must be verified/)
      return true
    },
  )
})
