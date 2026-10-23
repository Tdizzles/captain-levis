// Shared chat types. The response shape mirrors what script.js consumes exactly.
import type { AnswerValue, QStep, SvcKey, Widget } from './quoteflow.js'

export type Mode = 'start' | 'quote' | 'done'
/** Quote steps come from quoteflow.ts's plan; the list grows or shrinks with the job type. */
export type Step = QStep

export const DAMAGE_LOCATIONS = ['hull', 'deck', 'transom', 'stringers', 'bulkheads', 'gelcoat', 'other', 'not sure'] as const
export type DamageLocation = (typeof DAMAGE_LOCATIONS)[number]
export const DAMAGE_KINDS = ['structural', 'cosmetic', 'impact', 'not sure'] as const
export type DamageKind = (typeof DAMAGE_KINDS)[number]

export interface State {
  mode: Mode
  step?: Step
  /** set while the visitor is choosing what to change at review */
  changing?: boolean
  quoteStartedAt?: string
  /** set after the quote was submitted */
  inquiryRef?: string
  /** visitor explicitly asked a free question; next free text is treated as a question even mid-quote */
  asking?: boolean
  /** damage topics already given their "answer first" line, so chips and repeats stay short */
  answered?: string[]
}

export interface Slots {
  boat?: string
  boatMake?: string | null
  boatModel?: string | null
  boatYear?: number | null
  boatType?: string
  boatLength?: string
  /** the visitor's own words about the job (first message, typed answers, "anything else") */
  damage?: string
  damageLocation?: DamageLocation
  damageKind?: DamageKind
  /** job type picked from the tiles (or guessed from what they typed) */
  svc?: SvcKey
  /** follow-up id → chosen option values */
  answers?: Record<string, string[]>
  zones?: string[]
  size?: string
  where?: string
  whereStatus?: string
  city?: string
  timeline?: string
  notesDone?: boolean
  photos?: number
  photosDeclined?: boolean
  name?: string
  email?: string
  phone?: string
}

export interface Answer { step: string; value: AnswerValue }
export interface Chip { label: string; send?: string; href?: string; primary?: boolean; draft?: Draft; answer?: Answer }
export interface Link { label: string; href: string }
export interface Draft { name?: string; email?: string; phone?: string; service?: string; boat?: string; boatLocation?: string; message?: string }

export interface ChatResponse {
  sessionId: string
  reply: string
  chips: Chip[]
  links?: Link[]
  card?: [string, string][]
  draft?: Draft
  navigate?: string
  event?: 'quote_start' | 'quote_complete'
  done?: boolean
  /** quick-fill input for the current quote step (tiles, boat card, boat diagram, ...) */
  widget?: Widget
  /** quote progress, for the bar under the chat header */
  progress?: { n: number; of: number }
}

export interface StoredMessage { role: 'user' | 'assistant'; text: string; ts: string }

export interface ChatSessionRow {
  id: string
  state: State
  slots: Slots
  page: string | null
  messages: StoredMessage[]
  cost_usd: number
  token_in: number
  token_out: number
  inquiry_id: string | null
  created_at: Date | string
  last_seen_at: Date | string
}

/** Fields the model (or the regex extractor) may pull from one visitor message. All optional. */
export interface Extracted {
  boat?: string
  boatMake?: string
  boatModel?: string
  boatYear?: number
  boatType?: string
  damage?: string
  damageLocation?: DamageLocation
  damageKind?: DamageKind
  svc?: SvcKey
  where?: string
  name?: string
  email?: string
  phone?: string
  notSure?: boolean
}
