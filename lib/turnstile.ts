// Cloudflare Turnstile server-side verification (tokens are single-use; Cloudflare rejects replays).
// Secret unset → production refuses (503, "call us") unless ALLOW_UNVERIFIED_FORMS=true; dev/preview accept.
import { env } from './env.js'
import { HttpError } from './http.js'

export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
export const TURNSTILE_TEST_SECRET_PASS = '1x0000000000000000000000000000000AA'

export interface TurnstileResult { ok: boolean; skipped: boolean; errors: string[] }

export async function verifyTurnstile(token: string, remoteIp?: string): Promise<TurnstileResult> {
  const secret = env.turnstileSecret
  if (!secret) {
    if (env.isProduction && !env.allowUnverifiedForms) {
      throw new HttpError(503, 'Our form security check is not set up yet, so nothing was sent. Please call or text us and we will take your details by phone.')
    }
    return { ok: true, skipped: true, errors: [] }
  }
  if (!token) throw new HttpError(400, 'The security check did not complete. Please try again, or call us.', { fields: { turnstile_token: 'missing' } })
  const body = new URLSearchParams({ secret, response: token })
  if (remoteIp) body.set('remoteip', remoteIp)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 8000)
  try {
    const res = await fetch(SITEVERIFY_URL, { method: 'POST', body, signal: ctrl.signal })
    const data = (await res.json().catch(() => ({}))) as { success?: boolean; 'error-codes'?: string[] }
    if (!data.success) {
      const errors = data['error-codes'] || ['unknown']
      throw new HttpError(400, 'The security check failed or expired. Please try again, or call us.', { fields: { turnstile_token: errors.join(',') } })
    }
    return { ok: true, skipped: false, errors: [] }
  } catch (err) {
    if (err instanceof HttpError) throw err
    throw new HttpError(503, 'We could not reach the security check service, so nothing was sent. Please try again in a moment or call us.')
  } finally {
    clearTimeout(timer)
  }
}
