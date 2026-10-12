import { sql } from "../../db/client.js";

export type AuditEvent = {
  tenantId?: string;
  userId?: string;
  action: string;
  entityType?: string;
  entityId?: string;
  ip?: string;
  meta?: Record<string, unknown>;
};

/** Registra un evento en la bitácora. Nunca interrumpe la operación del usuario. */
export async function audit(event: AuditEvent) {
  try {
    await sql`
      insert into audit_log (tenant_id, user_id, action, entity_type, entity_id, ip, meta)
      values (${event.tenantId ?? null}, ${event.userId ?? null}, ${event.action}, ${event.entityType ?? null},
              ${event.entityId ?? null}, ${event.ip ?? null}, ${event.meta ? sql.json(event.meta as never) : null})
    `;
  } catch (error) {
    console.error("audit_log: no se pudo registrar", event.action, error instanceof Error ? error.message : error);
  }
}

export async function listAudit(tenantId: string, limit = 100) {
  const rows = await sql<{ id: string; user_id: string | null; action: string; entity_type: string | null; entity_id: string | null; ip: string | null; meta: unknown; created_at: Date }[]>`
    select id, user_id, action, entity_type, entity_id, ip, meta, created_at
    from audit_log where tenant_id = ${tenantId} order by id desc limit ${limit}
  `;
  return rows.map((row) => ({
    id: Number(row.id), userId: row.user_id ?? undefined, action: row.action, entityType: row.entity_type ?? undefined,
    entityId: row.entity_id ?? undefined, ip: row.ip ?? undefined, meta: row.meta ?? undefined, createdAt: row.created_at.toISOString()
  }));
}
