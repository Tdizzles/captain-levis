// Environment access. Everything is read at call time (not cached) so tests can flip values
// and so a missing credential degrades a feature instead of crashing the process.

const bool = (v: string | undefined, dflt = false) => (v == null || v === '' ? dflt : /^(1|true|yes|on)$/i.test(v))
const num = (v: string | undefined, dflt: number) => { const n = Number(v); return v != null && v !== '' && Number.isFinite(n) ? n : dflt }

export const env = {
  get vercelEnv() { return process.env.VERCEL_ENV || (process.env.NODE_ENV === 'production' ? 'production' : 'development') },
  get isProduction() { return this.vercelEnv === 'production' },
  get isTest() { return !!process.env.VITEST || process.env.NODE_ENV === 'test' },
  get databaseUrl() { return process.env.DATABASE_URL || '' },
  get autoMigrate() { return bool(process.env.AUTO_MIGRATE, true) },
  get sessionSecret() { return process.env.SESSION_SECRET || '' },
  get adminToken() { return process.env.ADMIN_API_TOKEN || '' },
  get turnstileSecret() { return process.env.TURNSTILE_SECRET_KEY || '' },
  get allowUnverifiedForms() { return bool(process.env.ALLOW_UNVERIFIED_FORMS, false) },
  get resendKey() { return process.env.RESEND_API_KEY || '' },
  get emailFrom() { return process.env.EMAIL_FROM || "Captain Levi's Website <inquiries@captainlevis.com>" },
  get emailTo() { return process.env.EMAIL_TO || 'captainlevis@yahoo.com' },
  get adminBaseUrl() { return (process.env.ADMIN_BASE_URL || '').replace(/\/$/, '') }, // '' → <site>/app (lib/business.ts appUrl)
  get aiReplyDraft() { return bool(process.env.AI_REPLY_DRAFT, false) },
  get staffPasswordHash() { return process.env.STAFF_PASSWORD_HASH || '' },
  get anthropicKey() { return process.env.ANTHROPIC_API_KEY || '' },
  get anthropicModel() { return process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5' },
  get anthropicAssistantModel() { return process.env.ANTHROPIC_ASSISTANT_MODEL || 'claude-opus-5-5' },
  get aiMonthlyBudgetUsd() { return num(process.env.AI_MONTHLY_BUDGET_USD, 25) },
  get maxPhotos() { return Math.max(1, Math.floor(num(process.env.MAX_PHOTOS, 5))) },
  get maxPhotoBytes() { return Math.max(1, num(process.env.MAX_PHOTO_MB, 10)) * 1024 * 1024 },
  get maxRequestBytes() { return 30 * 1024 * 1024 },
  get siteUrl() { return (process.env.SITE_URL || '').replace(/\/$/, '') },
  get version() { return process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || process.env.npm_package_version || 'dev' },
}

/** The HMAC secret actually in use. Falls back to a fixed, insecure dev key so local runs work; health reports it. */
export function effectiveSecret(): { secret: string; configured: boolean } {
  const s = env.sessionSecret
  if (s && s.length >= 16) return { secret: s, configured: true }
  return { secret: 'captain-levis-dev-insecure-secret-do-not-use-in-production', configured: false }
}
