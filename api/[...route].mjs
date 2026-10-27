import { createPromptOsServer } from '../server/index.mjs'

let serverPromise

function runtimeConfig() {
  const appUrl =
    process.env.APP_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    (process.env.VERCEL_ENV !== 'production' && process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : undefined)

  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.')
  if (!process.env.SESSION_SECRET || Buffer.byteLength(process.env.SESSION_SECRET) < 32) {
    throw new Error('SESSION_SECRET must contain at least 32 bytes.')
  }
  if (!process.env.ADMIN_EMAIL) throw new Error('ADMIN_EMAIL is required.')
  if (!appUrl || new URL(appUrl).protocol !== 'https:') throw new Error('APP_URL must be set to the canonical public HTTPS URL.')

  return {
    apiKey: process.env.OPENAI_API_KEY ?? '',
    baseUrl: process.env.OPENAI_BASE_URL,
    model: process.env.OPENAI_MODEL,
    maxTokens: Number(process.env.OPENAI_MAX_TOKENS) || undefined,
    timeoutMs: Number(process.env.AI_TIMEOUT_MS) || undefined,
    sessionSecret: process.env.SESSION_SECRET,
    adminEmail: process.env.ADMIN_EMAIL,
    appUrl,
    resendApiKey: process.env.RESEND_API_KEY,
    emailFrom: process.env.EMAIL_FROM,
    dailyLimit: Number(process.env.AI_DAILY_LIMIT) || undefined,
    secureCookies: true,
    trustProxy: true,
  }
}

export default async function handler(request, response) {
  try {
    serverPromise ??= createPromptOsServer({
      config: runtimeConfig(),
      databaseUrl: process.env.DATABASE_URL,
      logger: console,
    })
    const server = await serverPromise
    server.emit('request', request, response)
  } catch (error) {
    serverPromise = undefined
    console.error('PromptOS serverless request failed.', error)
    response.writeHead(503, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    })
    response.end(JSON.stringify({ error: 'PromptOS is not fully configured. Check the deployment environment variables.' }))
  }
}
