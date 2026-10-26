import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import Database from 'better-sqlite3'
import { createPromptOsServer } from './index.mjs'
import { createResendEmailSender } from './email.mjs'
import { createSecurityStore } from './securityStore.mjs'

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
      inviteCode: 'test-invitation-code',
      adminInviteCode: 'test-admin-setup-code',
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
    async register(email = 'member@example.com') {
      const response = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email,
          password: 'test-password-at-least-12',
          inviteCode: 'test-invitation-code',
          adminSetupCode: 'test-admin-setup-code',
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

test('registration is invitation-only and the first account receives admin access', async () => {
  const { baseUrl, register } = await startServer()
  const badInvite = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'attacker@example.com',
      password: 'test-password-at-least-12',
      inviteCode: 'wrong-invite-code',
    }),
  })
  const first = await register('admin@example.com')
  const second = await register('member@example.com')
  const adminView = await fetch(`${baseUrl}/api/admin/overview`, { headers: { cookie: first.cookie } })
  const memberView = await fetch(`${baseUrl}/api/admin/overview`, { headers: { cookie: second.cookie } })

  assert.equal(badInvite.status, 403)
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

test('configured administrator email cannot be reserved without the separate admin setup code', async () => {
  const { baseUrl, register } = await startServer({ config: { adminEmail: 'owner@example.com' } })
  const attemptedReservation = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'owner@example.com',
      password: 'attacker-password-123',
      inviteCode: 'test-invitation-code',
      adminSetupCode: 'wrong-admin-setup-code',
    }),
  })
  const owner = await register('owner@example.com')

  assert.equal(attemptedReservation.status, 403)
  assert.equal(owner.response.status, 202)
  assert.equal(owner.body.user.role, 'admin')
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
      inviteCode: 'test-invitation-code',
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
      assert.doesNotMatch(error.message, /provider secret diagnostic/)
      return true
    },
  )
})
