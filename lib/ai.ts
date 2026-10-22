// Anthropic client, monthly budget guard and usage logging. Every call goes through `callModel` so
// tokens and cost land in ai_usage; when there is no key or the budget is spent, callers get null
// and fall back to scripted behaviour.
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import type { z } from 'zod'
import type { Queryable } from './db.js'
import { env } from './env.js'
import { costUsd } from './pricing.js'

export type AiKind = 'chat' | 'reply_draft' | 'estimate_assistant'
export const TIMEOUT_MS = 25_000

let client: Anthropic | null = null
let clientKey = ''

export function aiConfigured(): boolean { return !!env.anthropicKey }

export function getAnthropic(): Anthropic | null {
  const key = env.anthropicKey
  if (!key) return null
  if (!client || clientKey !== key) { client = new Anthropic({ apiKey: key, timeout: TIMEOUT_MS, maxRetries: 1 }); clientKey = key }
  return client
}

export async function monthSpend(db: Queryable, now = new Date()): Promise<number> {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
  const r = await db.query<{ spent: number | string | null }>('SELECT coalesce(sum(cost_usd), 0)::float8 AS spent FROM ai_usage WHERE created_at >= $1', [start])
  return Number(r.rows[0]?.spent || 0)
}

export interface BudgetState { ok: boolean; spent: number; budget: number }

export async function budget(db: Queryable): Promise<BudgetState> {
  const b = env.aiMonthlyBudgetUsd
  const spent = await monthSpend(db)
  return { ok: spent < b, spent, budget: b }
}

export async function logUsage(db: Queryable, kind: AiKind, model: string, usage: Anthropic.Usage): Promise<number> {
  const cost = costUsd(model, usage)
  await db.query('INSERT INTO ai_usage (kind, model, tokens_in, tokens_out, cost_usd) VALUES ($1, $2, $3, $4, $5)', [
    kind, model, usage.input_tokens + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0), usage.output_tokens, cost,
  ])
  return cost
}

/** Per-model request tuning: keep short chat replies cheap and fast; models that can't take a param just omit it. */
function tuning(model: string): Partial<Anthropic.MessageCreateParamsNonStreaming> {
  if (/^claude-sonnet-5-5/.test(model)) return { thinking: { type: 'between_tools' }, output_config: { effort: 'low' } }
  if (/^claude-(opus-5-5|opus-5|haiku-5-5|fable)/.test(model)) return { output_config: { effort: 'low' } }
  if (/^claude-(opus-4-[678]|sonnet-5|sonnet-4-6)/.test(model)) return { thinking: { type: 'disabled' } }
  return {}
}

export interface CallResult<T> { parsed: T | null; text: string; usage: Anthropic.Usage; cost: number; stopReason: string | null; model: string }

/**
 * One structured call. `system` is an array: the first block is the stable persona (cached), the rest is
 * per-request context. The visitor's words only ever appear in `messages` user turns.
 */
export async function callModel<S extends z.ZodType>(db: Queryable, kind: AiKind, opts: {
  system: string[]; messages: Anthropic.MessageParam[]; schema: S; maxTokens: number; signal?: AbortSignal
}): Promise<CallResult<z.infer<S>> | null> {
  const anthropic = getAnthropic()
  if (!anthropic) return null
  const b = await budget(db)
  if (!b.ok) return null
  const model = env.anthropicModel
  const system: Anthropic.TextBlockParam[] = opts.system.map((text, i) => (i === 0 ? { type: 'text', text, cache_control: { type: 'ephemeral' } } : { type: 'text', text }))
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  if (opts.signal) opts.signal.addEventListener('abort', () => ctrl.abort(), { once: true })
  try {
    const res = await anthropic.messages.parse({
      model,
      max_tokens: opts.maxTokens,
      system,
      messages: opts.messages,
      output_config: { ...(tuning(model).output_config || {}), format: zodOutputFormat(opts.schema) },
      ...(tuning(model).thinking ? { thinking: tuning(model).thinking } : {}),
    }, { signal: ctrl.signal, timeout: TIMEOUT_MS })
    const cost = await logUsage(db, kind, model, res.usage)
    const text = res.content.filter((c): c is Anthropic.TextBlock => c.type === 'text').map((c) => c.text).join('')
    if (res.stop_reason === 'refusal') return { parsed: null, text: '', usage: res.usage, cost, stopReason: res.stop_reason, model }
    return { parsed: (res.parsed_output as z.infer<S> | null) ?? null, text, usage: res.usage, cost, stopReason: res.stop_reason, model }
  } catch (err) {
    if (err instanceof Anthropic.APIError) console.warn(`[ai] ${kind} ${err.status} ${err.message}`)
    else console.warn(`[ai] ${kind} failed:`, (err as Error)?.message || err)
    return null
  } finally {
    clearTimeout(timer)
  }
}
