// Applies db/migrations/NNN_*.sql in order, once each, tracked in schema_migrations.
//   npm run migrate            (uses DATABASE_URL; defaults to pglite://./.data/dev)
// Also runs automatically on the first getDb() per process unless AUTO_MIGRATE=false.
import type { Db } from './db.js'
import { MIGRATIONS } from '../db/migrations/index.js'

export async function migrate(db: Db): Promise<string[]> {
  await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())')
  const applied = new Set((await db.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name))
  const done: string[] = []
  for (const m of MIGRATIONS) {
    if (applied.has(m.name)) continue
    await db.transaction(async (tx) => {
      if (db.kind === 'pg') await tx.query('SELECT pg_advisory_xact_lock(727391763)')
      const again = await tx.query('SELECT 1 FROM schema_migrations WHERE name = $1', [m.name])
      if (again.rows.length) return
      await tx.exec(m.sql)
      await tx.query('INSERT INTO schema_migrations (name) VALUES ($1)', [m.name])
      done.push(m.name)
    })
  }
  return done
}

export async function migrationStatus(db: Db): Promise<{ applied: string[]; pending: string[] }> {
  let applied: string[] = []
  try {
    applied = (await db.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name')).rows.map((r) => r.name)
  } catch { /* table missing */ }
  const set = new Set(applied)
  return { applied, pending: MIGRATIONS.filter((m) => !set.has(m.name)).map((m) => m.name) }
}

// CLI entry: `tsx lib/migrate.ts`
const isMain = !!process.argv[1] && /[\\/]lib[\\/]migrate\.(ts|js)$/.test(process.argv[1])
if (isMain) {
  if (!process.env.DATABASE_URL) process.env.DATABASE_URL = 'pglite://./.data/dev'
  process.env.AUTO_MIGRATE = 'false'
  const { getDb } = await import('./db.js')
  const db = await getDb()
  const done = await migrate(db)
  console.log(done.length ? `applied: ${done.join(', ')}` : `nothing to apply (${MIGRATIONS.length} migration(s) already in place)`)
  await db.close()
}
