import { readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ROOT } from './helpers.js'

describe('migrations', () => {
  it('apply from scratch on PGlite, are idempotent, and the index lists every .sql file', async () => {
    const { MIGRATIONS } = await import('../db/migrations/index.js')
    const onDisk = readdirSync(path.join(ROOT, 'db/migrations')).filter((f) => f.endsWith('.sql')).map((f) => f.replace(/\.sql$/, '')).sort()
    expect(MIGRATIONS.map((m) => m.name).sort()).toEqual(onDisk)

    process.env.DATABASE_URL = 'pglite://memory'
    process.env.AUTO_MIGRATE = 'false'
    const { resetDbForTests, getDb } = await import('../lib/db.js')
    const { migrate, migrationStatus } = await import('../lib/migrate.js')
    await resetDbForTests()
    const db = await getDb()
    const first = await migrate(db)
    expect(first).toEqual(MIGRATIONS.map((m) => m.name))
    const second = await migrate(db)
    expect(second).toEqual([])
    const status = await migrationStatus(db)
    expect(status.pending).toEqual([])

    const tables = (await db.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1")).rows.map((r) => r.table_name)
    for (const t of ['inquiries', 'photos', 'chat_sessions', 'email_deliveries', 'rate_limits', 'analytics_events', 'audit_events', 'ai_usage', 'settings', 'schema_migrations', 'ref_counters']) expect(tables).toContain(t)
    await resetDbForTests()
    process.env.AUTO_MIGRATE = 'true'
  })
})
