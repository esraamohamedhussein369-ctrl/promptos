import { createHmac, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import pg from 'pg'
import { hashSecret } from './securityStore.mjs'

const { Pool } = pg
const scrypt = promisify(scryptCallback)
const sessionLifetimeMs = 7 * 24 * 60 * 60 * 1000
const retentionMs = 90 * 24 * 60 * 60 * 1000
const dayMs = 24 * 60 * 60 * 1000

function numericTimestamps(row, fields) {
  if (!row) return row
  for (const field of fields) {
    if (row[field] !== null && row[field] !== undefined) row[field] = Number(row[field])
  }
  return row
}

function userFromRow(row) {
  return numericTimestamps(row, ['created_at', 'disabled_at', 'email_verified_at'])
}

function usageFromRow(row) {
  if (!row) return row
  for (const field of ['total', 'runs', 'evaluations', 'duration_ms', 'total_tokens', 'created_at']) {
    if (row[field] !== null && row[field] !== undefined) row[field] = Number(row[field])
  }
  return row
}

export async function createPostgresSecurityStore(databaseUrl, sessionSecret) {
  if (typeof databaseUrl !== 'string' || !databaseUrl.trim()) {
    throw new Error('DATABASE_URL is required for the PostgreSQL security store.')
  }
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  })

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_salt BYTEA NOT NULL,
        password_hash BYTEA NOT NULL,
        created_at BIGINT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        disabled_at BIGINT,
        email_verified_at BIGINT
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash BYTEA PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at BIGINT NOT NULL,
        expires_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_expires_at ON sessions(expires_at);
      CREATE TABLE IF NOT EXISTS security_events (
        id TEXT PRIMARY KEY,
        user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        event_type TEXT NOT NULL,
        outcome TEXT NOT NULL,
        address_hash TEXT NOT NULL,
        created_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS security_events_created_at ON security_events(created_at);
      CREATE TABLE IF NOT EXISTS ai_usage (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        request_type TEXT NOT NULL CHECK(request_type IN ('run', 'evaluation')),
        status TEXT NOT NULL CHECK(status IN ('started', 'success', 'failed')),
        created_at BIGINT NOT NULL,
        duration_ms BIGINT,
        prompt_tokens BIGINT,
        completion_tokens BIGINT,
        total_tokens BIGINT,
        model TEXT
      );
      CREATE INDEX IF NOT EXISTS ai_usage_user_created_at ON ai_usage(user_id, created_at);
      CREATE TABLE IF NOT EXISTS email_tokens (
        token_hash BYTEA PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        purpose TEXT NOT NULL CHECK(purpose IN ('verify_email', 'reset_password')),
        created_at BIGINT NOT NULL,
        expires_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS email_tokens_user_purpose ON email_tokens(user_id, purpose);
      CREATE TABLE IF NOT EXISTS rate_limits (
        scope TEXT NOT NULL,
        address_hash TEXT NOT NULL,
        window_start BIGINT NOT NULL,
        request_count INTEGER NOT NULL,
        PRIMARY KEY (scope, address_hash, window_start)
      );
      CREATE INDEX IF NOT EXISTS rate_limits_window_start ON rate_limits(window_start);
    `)
  } catch (error) {
    await pool.end()
    throw error
  }

  function addressHash(address) {
    return createHmac('sha256', sessionSecret).update(address).digest('hex')
  }

  let lastCleanupAt = 0
  let cleanupPromise = null
  async function cleanExpired(now) {
    if (cleanupPromise) return cleanupPromise
    if (now - lastCleanupAt < 60_000) return
    cleanupPromise = Promise.all([
      pool.query('DELETE FROM sessions WHERE expires_at <= $1', [now]),
      pool.query('DELETE FROM email_tokens WHERE expires_at <= $1', [now]),
      pool.query('DELETE FROM rate_limits WHERE window_start < $1', [now - dayMs]),
      pool.query('DELETE FROM security_events WHERE created_at < $1', [now - retentionMs]),
      pool.query('DELETE FROM ai_usage WHERE created_at < $1', [now - retentionMs]),
    ])
      .then(() => {
        lastCleanupAt = now
      })
      .finally(() => {
        cleanupPromise = null
      })
    return cleanupPromise
  }

  async function inTransaction(operation) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const result = await operation(client)
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
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
        const result = await pool.query(
          `INSERT INTO users (id, email, password_salt, password_hash, created_at, role)
           SELECT $1, $2, $3, $4, $5, CASE
             WHEN $6 = 'admin' OR ($7::boolean AND NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin'))
             THEN 'admin' ELSE 'user' END
           RETURNING id, email, created_at, role, disabled_at, email_verified_at`,
          [id, email, salt, passwordHash, createdAt, requestedRole, bootstrapFirstAdmin],
        )
        return userFromRow(result.rows[0])
      } catch (error) {
        if (error.code === '23505') return null
        throw error
      }
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
    async getUserByEmail(email) {
      const result = await pool.query('SELECT * FROM users WHERE email = $1', [email])
      return userFromRow(result.rows[0])
    },
    async getUserById(id) {
      const result = await pool.query(
        'SELECT id, email, created_at, role, disabled_at, email_verified_at FROM users WHERE id = $1',
        [id],
      )
      return userFromRow(result.rows[0])
    },
    async getActiveUserCount() {
      const result = await pool.query('SELECT COUNT(*) AS count FROM users WHERE disabled_at IS NULL')
      return Number(result.rows[0].count)
    },
    async createSession(userId) {
      const token = randomBytes(32).toString('base64url')
      const now = Date.now()
      const expiresAt = now + sessionLifetimeMs
      await pool.query(
        'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)',
        [hashSecret(token), userId, now, expiresAt],
      )
      return { token, expiresAt }
    },
    async getSession(token) {
      const now = Date.now()
      await cleanExpired(now)
      const result = await pool.query(
        `SELECT users.id, users.email, users.role, users.disabled_at, users.email_verified_at, sessions.expires_at
         FROM sessions JOIN users ON users.id = sessions.user_id
         WHERE sessions.token_hash = $1 AND sessions.expires_at > $2`,
        [hashSecret(token), now],
      )
      return userFromRow(result.rows[0])
    },
    async deleteSession(token) {
      await pool.query('DELETE FROM sessions WHERE token_hash = $1', [hashSecret(token)])
    },
    async createEmailToken(userId, purpose, lifetimeMs) {
      const token = randomBytes(32).toString('base64url')
      const tokenHash = hashSecret(token)
      const now = Date.now()
      await inTransaction(async (client) => {
        await client.query('DELETE FROM email_tokens WHERE user_id = $1 AND purpose = $2', [userId, purpose])
        await client.query(
          'INSERT INTO email_tokens (token_hash, user_id, purpose, created_at, expires_at) VALUES ($1, $2, $3, $4, $5)',
          [tokenHash, userId, purpose, now, now + lifetimeMs],
        )
      })
      return token
    },
    async consumeEmailToken(token, purpose) {
      const tokenHash = hashSecret(token)
      return inTransaction(async (client) => {
        const result = await client.query(
          `SELECT users.id, users.email, users.role, email_tokens.purpose, email_tokens.expires_at
           FROM email_tokens JOIN users ON users.id = email_tokens.user_id
           WHERE email_tokens.token_hash = $1 FOR UPDATE OF email_tokens`,
          [tokenHash],
        )
        const row = result.rows[0]
        if (!row || row.purpose !== purpose) return null
        if (Number(row.expires_at) <= Date.now()) {
          await client.query('DELETE FROM email_tokens WHERE token_hash = $1', [tokenHash])
          return null
        }
        const deleted = await client.query(
          'DELETE FROM email_tokens WHERE token_hash = $1 RETURNING token_hash',
          [tokenHash],
        )
        if (deleted.rowCount !== 1) return null
        if (purpose === 'verify_email') {
          await client.query(
            'UPDATE users SET email_verified_at = $1 WHERE id = $2 AND email_verified_at IS NULL',
            [Date.now(), row.id],
          )
        }
        return { ...row, expires_at: Number(row.expires_at) }
      })
    },
    async changePassword(userId, password) {
      const salt = randomBytes(16)
      const passwordHash = await scrypt(password, salt, 64, {
        N: 16_384,
        r: 8,
        p: 1,
        maxmem: 64 * 1024 * 1024,
      })
      await inTransaction(async (client) => {
        await client.query('UPDATE users SET password_salt = $1, password_hash = $2 WHERE id = $3', [salt, passwordHash, userId])
        await client.query('DELETE FROM sessions WHERE user_id = $1', [userId])
        await client.query("DELETE FROM email_tokens WHERE user_id = $1 AND purpose = 'reset_password'", [userId])
      })
    },
    async consumeRateLimit({ scope, address, windowMs, limit }) {
      const now = Date.now()
      const windowStart = Math.floor(now / windowMs) * windowMs
      const result = await pool.query(
        `INSERT INTO rate_limits (scope, address_hash, window_start, request_count)
         VALUES ($1, $2, $3, 1)
         ON CONFLICT (scope, address_hash, window_start)
         DO UPDATE SET request_count = rate_limits.request_count + 1
         RETURNING request_count`,
        [scope, addressHash(address), windowStart],
      )
      if (now % dayMs < windowMs) await cleanExpired(now)
      return Number(result.rows[0].request_count) <= limit
    },
    async recordSecurityEvent({ userId = null, type, outcome, address }) {
      await pool.query(
        'INSERT INTO security_events (id, user_id, event_type, outcome, address_hash, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
        [randomUUID(), userId, type, outcome, addressHash(address), Date.now()],
      )
    },
    async startAiUsage(userId, requestType, dailyLimit) {
      const now = Date.now()
      const dayStart = new Date()
      dayStart.setUTCHours(0, 0, 0, 0)
      return inTransaction(async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [userId])
        const countResult = await client.query(
          "SELECT COUNT(*) AS count FROM ai_usage WHERE user_id = $1 AND created_at >= $2 AND status IN ('started', 'success', 'failed')",
          [userId, dayStart.getTime()],
        )
        const used = Number(countResult.rows[0].count)
        if (used >= dailyLimit) return { allowed: false, used, limit: dailyLimit }
        const id = randomUUID()
        await client.query(
          "INSERT INTO ai_usage (id, user_id, request_type, status, created_at) VALUES ($1, $2, $3, 'started', $4)",
          [id, userId, requestType, now],
        )
        return { allowed: true, used: used + 1, limit: dailyLimit, id }
      })
    },
    async finishAiUsage(id, { status, durationMs = null, usage = null, model = null }) {
      await pool.query(
        'UPDATE ai_usage SET status = $1, duration_ms = $2, prompt_tokens = $3, completion_tokens = $4, total_tokens = $5, model = $6 WHERE id = $7',
        [status, durationMs, usage?.promptTokens ?? null, usage?.completionTokens ?? null, usage?.totalTokens ?? null, model, id],
      )
    },
    async getDailyUsage(userId) {
      const dayStart = new Date()
      dayStart.setUTCHours(0, 0, 0, 0)
      const result = await pool.query(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN request_type = 'run' THEN 1 ELSE 0 END) AS runs,
           SUM(CASE WHEN request_type = 'evaluation' THEN 1 ELSE 0 END) AS evaluations
         FROM ai_usage
         WHERE user_id = $1 AND created_at >= $2 AND status IN ('started', 'success', 'failed')`,
        [userId, dayStart.getTime()],
      )
      const row = result.rows[0]
      return {
        total: Number(row.total),
        runs: Number(row.runs ?? 0),
        evaluations: Number(row.evaluations ?? 0),
      }
    },
    async getRecentEvents(limit = 50) {
      const result = await pool.query(
        `SELECT security_events.event_type, security_events.outcome, security_events.created_at, users.email
         FROM security_events LEFT JOIN users ON users.id = security_events.user_id
         ORDER BY security_events.created_at DESC
         LIMIT $1`,
        [limit],
      )
      return result.rows.map((row) => usageFromRow(row))
    },
    async getRecentUsage(limit = 50) {
      const result = await pool.query(
        `SELECT users.email, ai_usage.request_type, ai_usage.status, ai_usage.created_at, ai_usage.duration_ms, ai_usage.total_tokens, ai_usage.model
         FROM ai_usage JOIN users ON users.id = ai_usage.user_id
         ORDER BY ai_usage.created_at DESC
         LIMIT $1`,
        [limit],
      )
      return result.rows.map((row) => usageFromRow(row))
    },
    async close() {
      await pool.end()
    },
  }
}
