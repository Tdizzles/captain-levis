// One small query interface over two drivers:
//   DATABASE_URL=postgres://…   → pg Pool (Neon-compatible, SSL on unless localhost / sslmode=disable)
//   DATABASE_URL=pglite://<dir> → embedded PGlite persisted in <dir> (pglite://memory = in-memory)
//   unset                       → PGlite in memory outside production; "not configured" in production.
// Both drivers take $1-style params. jsonb params are passed as JSON strings with ::jsonb casts in SQL;
// bytea rows come back as Buffer on pg and Uint8Array on PGlite (normalize with Buffer.from).
import { env } from './env.js'

export interface QueryResult<T> { rows: T[]; rowCount: number }
export interface Queryable {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<QueryResult<T>>
  /** Simple-protocol execution: multi-statement SQL without params (migrations). */
  exec(sql: string): Promise<void>
}
export interface Db extends Queryable {
  kind: 'pg' | 'pglite'
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>
  close(): Promise<void>
}

export class DbNotConfiguredError extends Error {
  constructor() { super('DATABASE_URL is not configured'); this.name = 'DbNotConfiguredError' }
}

let instance: Promise<Db> | null = null
let instanceKey = ''

export function databaseMode(): 'pg' | 'pglite' | 'none' {
  const url = env.databaseUrl
  if (/^postgres(ql)?:\/\//i.test(url)) return 'pg'
  if (/^pglite:/i.test(url)) return 'pglite'
  if (!url && !env.isProduction) return 'pglite'
  return 'none'
}

type RawQuery = (text: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number | null; affectedRows?: number }>
type RawClient = { query: RawQuery; exec?: (sql: string) => Promise<unknown> }

function wrap(q: RawClient): Queryable {
  return {
    async query<T>(text: string, params: unknown[] = []) {
      const r = await q.query(text, params)
      return { rows: r.rows as T[], rowCount: r.rowCount ?? r.affectedRows ?? r.rows.length }
    },
    async exec(sql: string) {
      if (q.exec) await q.exec(sql)
      else await q.query(sql) // pg: no params → simple query protocol, multiple statements allowed
    },
  }
}

async function openPg(url: string): Promise<Db> {
  const { default: pg } = await import('pg')
  const u = new URL(url)
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname)
  const sslmode = u.searchParams.get('sslmode')
  const ssl = sslmode === 'disable' || (local && !sslmode) ? undefined : { rejectUnauthorized: true }
  const pool = new pg.Pool({ connectionString: url, ssl, max: 3, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 8_000 })
  const base = wrap(pool as unknown as RawClient)
  return {
    kind: 'pg',
    query: base.query,
    exec: base.exec,
    async transaction(fn) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const out = await fn(wrap(client as unknown as RawClient))
        await client.query('COMMIT')
        return out
      } catch (e) {
        try { await client.query('ROLLBACK') } catch { /* ignore */ }
        throw e
      } finally { client.release() }
    },
    close: () => pool.end(),
  }
}

async function openPglite(url: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite')
  let dir = url.replace(/^pglite:(\/\/)?/i, '')
  if (!dir || dir === 'memory' || dir === ':memory:') dir = ''
  const pg = dir ? new PGlite(dir) : new PGlite()
  await pg.waitReady
  const base = wrap(pg as unknown as RawClient)
  return {
    kind: 'pglite',
    query: base.query,
    exec: base.exec,
    transaction: (fn) => pg.transaction((tx) => fn(wrap(tx as unknown as RawClient))),
    close: () => pg.close(),
  }
}

/** Open (once per process) and, unless AUTO_MIGRATE=false, migrate the database. */
export function getDb(): Promise<Db> {
  const mode = databaseMode()
  if (mode === 'none') return Promise.reject(new DbNotConfiguredError())
  const key = `${mode}:${env.databaseUrl}`
  if (instance && instanceKey === key) return instance
  instanceKey = key
  const p = (async () => {
    const db = mode === 'pg' ? await openPg(env.databaseUrl) : await openPglite(env.databaseUrl)
    if (env.autoMigrate) {
      const { migrate } = await import('./migrate.js')
      await migrate(db)
    }
    return db
  })()
  instance = p
  p.catch(() => { if (instance === p) { instance = null; instanceKey = '' } })
  return p
}

/** Tests: drop the cached instance so the next getDb() opens a fresh database. */
export async function resetDbForTests(): Promise<void> {
  const cur = instance
  instance = null; instanceKey = ''
  if (cur) { try { await (await cur).close() } catch { /* ignore */ } }
}

export async function dbHealthy(): Promise<boolean> {
  try { const db = await getDb(); await db.query('SELECT 1'); return true } catch { return false }
}
