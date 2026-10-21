// GET /api/health → {ok, configured:{database, anthropic, resend, turnstile, session_secret, admin_token}, version, ...}
// Never includes secret values. ok = the database answers.
import { databaseMode, dbHealthy, getDb } from '../lib/db.js'
import { effectiveSecret, env } from '../lib/env.js'
import { requireMethod, route, sendJson } from '../lib/http.js'
import { knowledgePages } from '../lib/chat/knowledge.js'
import { migrationStatus } from '../lib/migrate.js'
import { monthSpend } from '../lib/ai.js'

export default route(async (req, res) => {
  requireMethod(req, 'GET', 'HEAD')
  const mode = databaseMode()
  const dbOk = mode !== 'none' && (await dbHealthy())
  const configured = {
    database: mode === 'pg',
    anthropic: !!env.anthropicKey,
    resend: !!env.resendKey,
    turnstile: !!env.turnstileSecret,
    session_secret: effectiveSecret().configured,
    admin_token: !!env.adminToken,
  }
  const out: Record<string, unknown> = {
    ok: dbOk,
    env: env.vercelEnv,
    version: env.version,
    configured,
    database: { mode, reachable: dbOk },
    knowledge: { pages: knowledgePages().length },
    missing: Object.entries(configured).filter(([, v]) => !v).map(([k]) => k),
  }
  if (dbOk) {
    const db = await getDb()
    try {
      out.migrations = await migrationStatus(db)
      const failed = await db.query<{ n: string | number }>(`SELECT count(*) AS n FROM email_deliveries WHERE status IN ('failed','pending_config')`)
      out.email = { unsent: Number(failed.rows[0]?.n || 0) }
      out.ai = { monthSpendUsd: Math.round((await monthSpend(db)) * 1e4) / 1e4, budgetUsd: env.aiMonthlyBudgetUsd, model: env.anthropicModel }
    } catch (e) { out.warning = (e as Error).message }
  }
  sendJson(res, dbOk ? 200 : 503, out)
})
