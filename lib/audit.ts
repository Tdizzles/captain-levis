import type { Queryable } from './db.js'

export async function audit(db: Queryable, actor: string, action: string, entity: string, entityId: string | null, data: Record<string, unknown> = {}): Promise<void> {
  await db.query(
    'INSERT INTO audit_events (actor, action, entity, entity_id, data) VALUES ($1, $2, $3, $4, $5::jsonb)',
    [actor, action, entity, entityId, JSON.stringify(data)],
  )
}
