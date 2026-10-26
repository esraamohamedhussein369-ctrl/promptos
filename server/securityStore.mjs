import { createHmac, createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { promisify } from 'node:util'
import Database from 'better-sqlite3'

const scrypt = promisify(scryptCallback)
const sessionLifetimeMs = 7 * 24 * 60 * 60 * 1000

export function hashSecret(value) {
  return createHash('sha256').update(value).digest()
}

export function safeEqual(left, right) {
  const leftHash = hashSecret(left)
  const rightHash = hashSecret(right)
  return timingSafeEqual(leftHash, rightHash)
}

export function createSecurityStore(databasePath, sessionSecret) {
  if (databasePath !== ':memory:') {
    mkdirSync(dirname(resolve(databasePath)), { recursive: true })
  }
  const database = new Database(databasePath)
  database.pragma('journal_mode = WAL')
  database.pragma('foreign_keys = ON')
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_salt BLOB NOT NULL,
      password_hash BLOB NOT NULL,
      created_at INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      disabled_at INTEGER,
      email_verified_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash BLOB PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_expires_at ON sessions(expires_at);
    CREATE TABLE IF NOT EXISTS security_events (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      event_type TEXT NOT NULL,
      outcome TEXT NOT NULL,
      address_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS security_events_created_at ON security_events(created_at);
    CREATE TABLE IF NOT EXISTS ai_usage (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      request_type TEXT NOT NULL CHECK(request_type IN ('run', 'evaluation')),
      status TEXT NOT NULL CHECK(status IN ('started', 'success', 'failed')),
      created_at INTEGER NOT NULL,
      duration_ms INTEGER,
      prompt_tokens INTEGER,
      completion_tokens INTEGER,
      total_tokens INTEGER,
      model TEXT
    );
    CREATE INDEX IF NOT EXISTS ai_usage_user_created_at ON ai_usage(user_id, created_at);
    CREATE TABLE IF NOT EXISTS email_tokens (
      token_hash BLOB PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      purpose TEXT NOT NULL CHECK(purpose IN ('verify_email', 'reset_password')),
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS email_tokens_user_purpose ON email_tokens(user_id, purpose);
    CREATE TABLE IF NOT EXISTS rate_limits (
      scope TEXT NOT NULL,
      address_hash TEXT NOT NULL,
      window_start INTEGER NOT NULL,
      request_count INTEGER NOT NULL,
      PRIMARY KEY (scope, address_hash, window_start)
    );
    CREATE INDEX IF NOT EXISTS rate_limits_window_start ON rate_limits(window_start);
  `)
  const userColumns = new Set(database.pragma('table_info(users)').map((column) => column.name))
  if (!userColumns.has('email_verified_at')) {
    database.exec('ALTER TABLE users ADD COLUMN email_verified_at INTEGER')
  }

  const statements = {
    getUserByEmail: database.prepare('SELECT * FROM users WHERE email = ?'),
    getUserById: database.prepare('SELECT id, email, created_at, role, disabled_at, email_verified_at FROM users WHERE id = ?'),
    createSession: database.prepare(
      'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    ),
    getSession: database.prepare(`
      SELECT users.id, users.email, users.role, users.disabled_at, users.email_verified_at, sessions.expires_at
      FROM sessions JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ? AND sessions.expires_at > ?
    `),
    deleteSession: database.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    deleteUserSessions: database.prepare('DELETE FROM sessions WHERE user_id = ?'),
    createEmailToken: database.prepare(
      'INSERT INTO email_tokens (token_hash, user_id, purpose, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
    ),
    getEmailToken: database.prepare(
      'SELECT users.id, users.email, users.role, email_tokens.purpose, email_tokens.expires_at FROM email_tokens JOIN users ON users.id = email_tokens.user_id WHERE email_tokens.token_hash = ?',
    ),
    deleteEmailToken: database.prepare('DELETE FROM email_tokens WHERE token_hash = ?'),
    deleteUserEmailTokens: database.prepare('DELETE FROM email_tokens WHERE user_id = ? AND purpose = ?'),
    verifyEmail: database.prepare('UPDATE users SET email_verified_at = ? WHERE id = ? AND email_verified_at IS NULL'),
    updatePassword: database.prepare('UPDATE users SET password_salt = ?, password_hash = ? WHERE id = ?'),
    consumeRateLimit: database.prepare(`
      INSERT INTO rate_limits (scope, address_hash, window_start, request_count)
      VALUES (?, ?, ?, 1)
      ON CONFLICT (scope, address_hash, window_start)
      DO UPDATE SET request_count = request_count + 1
      RETURNING request_count
    `),
    pruneRateLimits: database.prepare('DELETE FROM rate_limits WHERE window_start < ?'),
    pruneExpiredEmailTokens: database.prepare('DELETE FROM email_tokens WHERE expires_at <= ?'),
    deleteExpiredSessions: database.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
    insertEvent: database.prepare(
      'INSERT INTO security_events (id, user_id, event_type, outcome, address_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ),
    countDailyUsage: database.prepare(
      "SELECT COUNT(*) AS count FROM ai_usage WHERE user_id = ? AND created_at >= ? AND status IN ('started', 'success', 'failed')",
    ),
    insertUsage: database.prepare(
      "INSERT INTO ai_usage (id, user_id, request_type, status, created_at) VALUES (?, ?, ?, 'started', ?)",
    ),
    finishUsage: database.prepare(
      'UPDATE ai_usage SET status = ?, duration_ms = ?, prompt_tokens = ?, completion_tokens = ?, total_tokens = ?, model = ? WHERE id = ?',
    ),
    usageSummary: database.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN request_type = 'run' THEN 1 ELSE 0 END) AS runs,
        SUM(CASE WHEN request_type = 'evaluation' THEN 1 ELSE 0 END) AS evaluations
      FROM ai_usage
      WHERE user_id = ? AND created_at >= ? AND status IN ('started', 'success', 'failed')
    `),
    countAllUsers: database.prepare('SELECT COUNT(*) AS count FROM users WHERE disabled_at IS NULL'),
    recentEvents: database.prepare(`
      SELECT security_events.event_type, security_events.outcome, security_events.created_at, users.email
      FROM security_events LEFT JOIN users ON users.id = security_events.user_id
      ORDER BY security_events.created_at DESC
      LIMIT ?
    `),
    recentUsage: database.prepare(`
      SELECT users.email, ai_usage.request_type, ai_usage.status, ai_usage.created_at, ai_usage.duration_ms, ai_usage.total_tokens, ai_usage.model
      FROM ai_usage JOIN users ON users.id = ai_usage.user_id
      ORDER BY ai_usage.created_at DESC
      LIMIT ?
    `),
    pruneOldEvents: database.prepare('DELETE FROM security_events WHERE created_at < ?'),
    pruneOldUsage: database.prepare('DELETE FROM ai_usage WHERE created_at < ?'),
  }

  const cleanExpired = database.transaction((now) => {
    statements.deleteExpiredSessions.run(now)
    statements.pruneOldEvents.run(now - 90 * 24 * 60 * 60 * 1000)
    statements.pruneOldUsage.run(now - 90 * 24 * 60 * 60 * 1000)
    statements.pruneRateLimits.run(now - 24 * 60 * 60 * 1000)
    statements.pruneExpiredEmailTokens.run(now)
  })

  function addressHash(address) {
    return createHmac('sha256', sessionSecret).update(address).digest('hex')
  }

  return {
    async createUser(email, password, requestedRole = 'user', bootstrapFirstAdmin = false) {
      const salt = randomBytes(16)
      const passwordHash = await scrypt(password, salt, 64, {
        N: 16_384,
        r: 8,
        p: 1,
        maxmem: 64 * 1024 * 1024,
      })
      const id = randomUUID()
      const createdAt = Date.now()
      try {
        database.prepare(
          `INSERT INTO users (id, email, password_salt, password_hash, created_at, role)
           SELECT ?, ?, ?, ?, ?, CASE
             WHEN ? = 'admin' OR (? = 1 AND NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin'))
             THEN 'admin' ELSE 'user' END`,
        ).run(id, email, salt, passwordHash, createdAt, requestedRole, bootstrapFirstAdmin ? 1 : 0)
      } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return null
        throw error
      }
      return { ...statements.getUserById.get(id), createdAt }
    },
    async verifyPassword(user, password) {
      const salt = user?.password_salt ?? Buffer.from('promptos-dummy-password-salt')
      const candidate = await scrypt(password, salt, 64, {
        N: 16_384,
        r: 8,
        p: 1,
        maxmem: 64 * 1024 * 1024,
      })
      const storedHash = user?.password_hash ?? Buffer.alloc(64)
      return timingSafeEqual(candidate, storedHash) && Boolean(user && !user.disabled_at)
    },
    getUserByEmail(email) {
      return statements.getUserByEmail.get(email)
    },
    getUserById(id) {
      return statements.getUserById.get(id)
    },
    getActiveUserCount() {
      return statements.countAllUsers.get().count
    },
    createSession(userId) {
      const token = randomBytes(32).toString('base64url')
      const now = Date.now()
      const expiresAt = now + sessionLifetimeMs
      statements.createSession.run(hashSecret(token), userId, now, expiresAt)
      return { token, expiresAt }
    },
    getSession(token) {
      const now = Date.now()
      cleanExpired(now)
      return statements.getSession.get(hashSecret(token), now) ?? null
    },
    deleteSession(token) {
      statements.deleteSession.run(hashSecret(token))
    },
    createEmailToken(userId, purpose, lifetimeMs) {
      const token = randomBytes(32).toString('base64url')
      const now = Date.now()
      statements.deleteUserEmailTokens.run(userId, purpose)
      statements.createEmailToken.run(hashSecret(token), userId, purpose, now, now + lifetimeMs)
      return token
    },
    consumeEmailToken(token, purpose) {
      const tokenHash = hashSecret(token)
      const consume = database.transaction(() => {
        const row = statements.getEmailToken.get(tokenHash)
        if (!row || row.purpose !== purpose) return null
        if (row.expires_at <= Date.now()) {
          statements.deleteEmailToken.run(tokenHash)
          return null
        }
        const deleted = statements.deleteEmailToken.run(tokenHash)
        if (deleted.changes !== 1) return null
        if (purpose === 'verify_email') statements.verifyEmail.run(Date.now(), row.id)
        return row
      })
      return consume()
    },
    async changePassword(userId, password) {
      const salt = randomBytes(16)
      const passwordHash = await scrypt(password, salt, 64, {
        N: 16_384,
        r: 8,
        p: 1,
        maxmem: 64 * 1024 * 1024,
      })
      statements.updatePassword.run(salt, passwordHash, userId)
      statements.deleteUserSessions.run(userId)
      statements.deleteUserEmailTokens.run(userId, 'reset_password')
    },
    consumeRateLimit({ scope, address, windowMs, limit }) {
      const now = Date.now()
      cleanExpired(now)
      const windowStart = Math.floor(now / windowMs) * windowMs
      const requestCount = statements.consumeRateLimit.get(
        scope,
        addressHash(address),
        windowStart,
      ).request_count
      return requestCount <= limit
    },
    recordSecurityEvent({ userId = null, type, outcome, address }) {
      statements.insertEvent.run(randomUUID(), userId, type, outcome, addressHash(address), Date.now())
    },
    startAiUsage(userId, requestType, dailyLimit) {
      const now = Date.now()
      const dayStart = new Date()
      dayStart.setUTCHours(0, 0, 0, 0)
      const used = statements.countDailyUsage.get(userId, dayStart.getTime()).count
      if (used >= dailyLimit) return { allowed: false, used, limit: dailyLimit }
      const id = randomUUID()
      statements.insertUsage.run(id, userId, requestType, now)
      return { allowed: true, used: used + 1, limit: dailyLimit, id }
    },
    finishAiUsage(id, { status, durationMs = null, usage = null, model = null }) {
      statements.finishUsage.run(
        status,
        durationMs,
        usage?.promptTokens ?? null,
        usage?.completionTokens ?? null,
        usage?.totalTokens ?? null,
        model,
        id,
      )
    },
    getDailyUsage(userId) {
      const dayStart = new Date()
      dayStart.setUTCHours(0, 0, 0, 0)
      return statements.usageSummary.get(userId, dayStart.getTime())
    },
    getRecentEvents(limit = 50) {
      return statements.recentEvents.all(limit)
    },
    getRecentUsage(limit = 50) {
      return statements.recentUsage.all(limit)
    },
    close() {
      database.close()
    },
  }
}

export const sessionCookieName = 'promptos_session'

export function readCookie(request, name) {
  const header = request.headers.cookie
  if (!header) return null
  for (const item of header.split(';')) {
    const separator = item.indexOf('=')
    if (separator < 0) continue
    if (item.slice(0, separator).trim() === name) {
      try {
        return decodeURIComponent(item.slice(separator + 1).trim())
      } catch {
        return null
      }
    }
  }
  return null
}

export function sessionCookie(token, maxAgeSeconds, secure) {
  return `${sessionCookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`
}

export function clearSessionCookie(secure) {
  return `${sessionCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`
}
