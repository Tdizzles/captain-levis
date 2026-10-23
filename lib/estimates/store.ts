// Estimate persistence: numbering, create-from-inquiry, save with version history, presentation with signed photo URLs.
import { business } from '../business.js'
import { describeBoat } from '../boat.js'
import type { Db, Queryable } from '../db.js'
import type { InquiryRow } from '../inquiries.js'
import { listPhotos, signPhotoUrl, type PhotoRow } from '../photos.js'
import { assessInquiry } from '../quote/missing.js'
import { skeletonFor } from '../quote/skeleton.js'
import { calcTotals, layoutLines, type LineLayout, type Totals } from './calc.js'
import { newEstimate, newId, newLine, normalizeEstimate, todayISO, type Estimate } from './types.js'

export interface EstimateRow {
  id: string; number: string; inquiry_id: string | null; status: Estimate['status']; customer_name: string; vessel_label: string
  total_cents: number; doc: Estimate; totals: Totals; created_by: string | null; created_at: Date | string; updated_at: Date | string
}

const COLS = 'id, number, inquiry_id, status, customer_name, vessel_label, total_cents, doc, totals, created_by, created_at, updated_at'

/** Photos are stored as photo:<uuid> and signed on the way out, so the document never holds an expiring URL. */
export const PHOTO_REF = 'photo:'

export async function nextEstimateNumber(tx: Queryable): Promise<string> {
  const r = await tx.query<{ n: number }>('UPDATE estimate_seq SET n = n + 1 WHERE id = 1 RETURNING n', [])
  return `E-${Number(r.rows[0].n)}`
}

const DEFAULT_TERMS = `This estimate is based on visible damage and the information provided. Hidden damage found once the repair is opened up will be reported with photos before any additional work is done. Estimate valid 30 days. Work begins on approval; the boat is released on final payment.`

function vesselLabel(e: Estimate): string {
  return [e.vessel.year, e.vessel.make, e.vessel.model].filter(Boolean).join(' ')
}

/** A draft pre-filled from a website inquiry: customer, boat, insurance flag, photos and a first section. */
export function draftFromInquiry(i: InquiryRow, photos: PhotoRow[]): Estimate {
  const a = assessInquiry(i, photos.length)
  const biz = business()
  const e = newEstimate({
    status: 'draft',
    docKind: a.insurance ? 'supplement' : 'estimate',
    revision: 0,
    customer: { name: i.name, email: i.email, phone: i.phone, company: '', addressLines: [] },
    vessel: { year: i.boat_year ? String(i.boat_year) : '', make: i.boat_make || '', model: i.boat_model || (i.boat_raw && !i.boat_make ? i.boat_raw : ''), name: '', hin: '', registration: '', location: i.boat_location || '' },
    insurance: { enabled: a.insurance },
    notes: `From website inquiry ${i.ref} (${describeBoat({ make: i.boat_make, model: i.boat_model, year: i.boat_year, raw: i.boat_raw }) || 'boat not given'}).\nCustomer wrote: ${i.message.trim()}`,
    terms: DEFAULT_TERMS,
    estimateDate: todayISO(),
    photos: photos.map((p, n) => ({ id: newId(), url: `${PHOTO_REF}${p.id}`, caption: `Customer photo ${n + 1} (${p.filename})` })),
  })
  // chat inquiries carry the quote flow's answers: build the sections and named line items from them (unpriced)
  const skeleton = i.details?.job ? skeletonFor(i.details) : []
  if (skeleton.length) {
    e.sections = skeleton.map((sk) => ({ id: newId(), title: sk.title }))
    e.lines = skeleton.flatMap((sk, n) => sk.lines.map((description) => newLine(e, { sectionId: e.sections[n].id, description, hours: 0 })))
  } else {
    const section = { id: newId(), title: a.mentions.area ? `${capitalize(a.mentions.area)} repair` : 'Repair' }
    e.sections = [section]
    e.lines = [newLine(e, { sectionId: section.id, description: 'Inspect and grind back to sound laminate', hours: 0 })]
  }
  if (!e.pricing.taxNote) e.pricing.taxNote = biz.address.state === 'FL' ? '6% Florida + 1% Pinellas County' : ''
  return e
}

function capitalize(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1) }

export function blankDraft(): Estimate {
  const e = newEstimate({ terms: DEFAULT_TERMS, estimateDate: todayISO() })
  const section = { id: newId(), title: 'Repair' }
  e.sections = [section]
  e.lines = [newLine(e, { sectionId: section.id })]
  return e
}

export async function createEstimate(db: Db, doc: Estimate, opts: { inquiryId?: string | null; actor: string }): Promise<EstimateRow> {
  return db.transaction(async (tx) => {
    const number = await nextEstimateNumber(tx)
    const e = normalizeEstimate({ ...doc, id: doc.id || newId(), number })
    const totals = calcTotals(e)
    const r = await tx.query<EstimateRow>(
      `INSERT INTO estimates (id, number, inquiry_id, status, customer_name, vessel_label, total_cents, doc, totals, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10) RETURNING ${COLS}`,
      [e.id, number, opts.inquiryId || null, e.status, e.customer.name, vesselLabel(e), totals.totalCents, JSON.stringify(e), JSON.stringify(totals), opts.actor],
    )
    await tx.query('INSERT INTO estimate_versions (estimate_id, version, doc, actor, reason) VALUES ($1, 1, $2::jsonb, $3, $4)', [e.id, JSON.stringify(e), opts.actor, 'created'])
    return r.rows[0]
  })
}

export async function getEstimate(db: Queryable, id: string): Promise<EstimateRow | null> {
  return (await db.query<EstimateRow>(`SELECT ${COLS} FROM estimates WHERE id = $1`, [id])).rows[0] || null
}

export async function listEstimates(db: Queryable, opts: { status?: string; inquiryId?: string; limit?: number } = {}): Promise<Omit<EstimateRow, 'doc'>[]> {
  const where: string[] = [], params: unknown[] = []
  if (opts.status) { params.push(opts.status); where.push(`status = $${params.length}`) }
  if (opts.inquiryId) { params.push(opts.inquiryId); where.push(`inquiry_id = $${params.length}`) }
  params.push(Math.min(500, Math.max(1, opts.limit || 100)))
  const sql = `SELECT id, number, inquiry_id, status, customer_name, vessel_label, total_cents, totals, created_by, created_at, updated_at FROM estimates ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY updated_at DESC LIMIT $${params.length}`
  return (await db.query<Omit<EstimateRow, 'doc'>>(sql, params)).rows
}

/** Saves a whole document (normalized), keeping the previous one as a version. Returns the stored row. */
export async function saveEstimate(db: Db, id: string, input: unknown, opts: { actor: string; reason?: string }): Promise<EstimateRow | null> {
  return db.transaction(async (tx) => {
    const cur = (await tx.query<EstimateRow>(`SELECT ${COLS} FROM estimates WHERE id = $1 FOR UPDATE`, [id])).rows[0]
    if (!cur) return null
    const e = normalizeEstimate({ ...(typeof input === 'object' && input ? input : {}), id: cur.id, number: cur.number, createdAt: cur.doc.createdAt, updatedAt: new Date().toISOString() })
    const totals = calcTotals(e)
    const v = await tx.query<{ v: number }>('SELECT coalesce(max(version), 0) + 1 AS v FROM estimate_versions WHERE estimate_id = $1', [id])
    await tx.query('INSERT INTO estimate_versions (estimate_id, version, doc, actor, reason) VALUES ($1, $2, $3::jsonb, $4, $5)', [id, Number(v.rows[0].v), JSON.stringify(e), opts.actor, opts.reason || null])
    const r = await tx.query<EstimateRow>(
      `UPDATE estimates SET status = $2, customer_name = $3, vessel_label = $4, total_cents = $5, doc = $6::jsonb, totals = $7::jsonb, updated_at = now() WHERE id = $1 RETURNING ${COLS}`,
      [id, e.status, e.customer.name, vesselLabel(e), totals.totalCents, JSON.stringify(e), JSON.stringify(totals)],
    )
    return r.rows[0]
  })
}

export interface VersionRow { version: number; actor: string; reason: string | null; created_at: Date | string }

export async function listVersions(db: Queryable, id: string): Promise<VersionRow[]> {
  return (await db.query<VersionRow>('SELECT version, actor, reason, created_at FROM estimate_versions WHERE estimate_id = $1 ORDER BY version DESC', [id])).rows
}

export async function getVersionDoc(db: Queryable, id: string, version: number): Promise<Estimate | null> {
  const r = await db.query<{ doc: Estimate }>('SELECT doc FROM estimate_versions WHERE estimate_id = $1 AND version = $2', [id, version])
  return r.rows[0]?.doc || null
}

export async function deleteEstimate(db: Queryable, id: string): Promise<boolean> {
  return (await db.query('DELETE FROM estimates WHERE id = $1', [id])).rowCount > 0
}

/** The document as the browser should see it: photo refs turned into signed URLs (7 days). */
export function presentDoc(e: Estimate, ttl = 7 * 24 * 3600): Estimate {
  return { ...e, photos: e.photos.map((p) => (p.url.startsWith(PHOTO_REF) ? { ...p, url: signPhotoUrl(p.url.slice(PHOTO_REF.length), ttl) } : p)) }
}

export interface Presented { estimate: Estimate; totals: Totals; layout: LineLayout; number: string; id: string; inquiry_id: string | null; status: Estimate['status']; updated_at: Date | string; created_at: Date | string }

export function present(row: EstimateRow): Presented {
  const estimate = presentDoc(row.doc)
  return { id: row.id, number: row.number, inquiry_id: row.inquiry_id, status: row.status, estimate, totals: calcTotals(estimate), layout: layoutLines(estimate), updated_at: row.updated_at, created_at: row.created_at }
}

export async function inquiryPhotosFor(db: Queryable, inquiryId: string): Promise<PhotoRow[]> {
  return listPhotos(db, { inquiryId })
}
