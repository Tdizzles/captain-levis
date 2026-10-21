// Anthropic list prices, USD per million tokens (Claude API first-party rates, cached 2026-10-06 from the
// claude-api skill). cacheWrite = 1.25× input (5-minute TTL); cacheRead per the published rate.
export interface ModelPrice { input: number; output: number; cacheRead: number; cacheWrite: number }

export const PRICES: Record<string, ModelPrice> = {
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
  'claude-fable-5': { input: 10, output: 50, cacheRead: 1.0, cacheWrite: 12.5 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4-7': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4-6': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
}

/** Unknown model ids are priced at the most expensive tier so the budget guard errs on the safe side. */
export function priceFor(model: string): ModelPrice {
  return PRICES[model] || PRICES[model.replace(/-\d{8}$/, '')] || PRICES['claude-fable-5-1']
}

export interface UsageLike { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }

export function costUsd(model: string, u: UsageLike): number {
  const p = priceFor(model)
  const m = 1_000_000
  const cost = (u.input_tokens / m) * p.input + (u.output_tokens / m) * p.output
    + ((u.cache_read_input_tokens || 0) / m) * p.cacheRead + ((u.cache_creation_input_tokens || 0) / m) * p.cacheWrite
  return Math.round(cost * 1e6) / 1e6
}
