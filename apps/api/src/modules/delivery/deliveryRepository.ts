import { randomUUID } from "node:crypto";
import { sql } from "../../db/client.js";

export type DeliveryChannel = "WHATSAPP" | "EMAIL" | "SMS";
export type DeliveryStatus = "WAITING_RECEIPT" | "PENDING" | "PROCESSING" | "SENT" | "FAILED" | "CANCELLED";

export type DeliveryRecord = {
  id: string;
  tenantId: string;
  receiptId: string;
  channel: DeliveryChannel;
  destination: string;
  status: DeliveryStatus;
  idempotencyKey: string;
  attemptCount: number;
  providerCode?: string;
  providerMessageId?: string;
  lastError?: string;
  sentAt?: string;
};

type DeliveryRow = {
  id: string;
  tenant_id: string;
  receipt_id: string;
  channel: DeliveryChannel;
  destination: string;
  status: DeliveryStatus;
  idempotency_key: string;
  attempt_count: number;
  provider_code: string | null;
  provider_message_id: string | null;
  last_error: string | null;
  sent_at: Date | string | null;
};

function map(row: DeliveryRow): DeliveryRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    receiptId: row.receipt_id,
    channel: row.channel,
    destination: row.destination,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    attemptCount: row.attempt_count,
    providerCode: row.provider_code ?? undefined,
    providerMessageId: row.provider_message_id ?? undefined,
    lastError: row.last_error ?? undefined,
    sentAt: row.sent_at ? new Date(row.sent_at).toISOString() : undefined
  };
}

export async function enqueueDelivery(input: {
  tenantId: string;
  receiptId: string;
  channel: DeliveryChannel;
  destination: string;
  idempotencyKey: string;
  waitForReceipt?: boolean;
}) {
  const rows = await sql<DeliveryRow[]>`
    insert into receipt_deliveries (
      id, tenant_id, receipt_id, channel, destination, status, idempotency_key
    ) values (
      ${randomUUID()}, ${input.tenantId}, ${input.receiptId}, ${input.channel}, ${input.destination},
      ${input.waitForReceipt ? "WAITING_RECEIPT" : "PENDING"}, ${input.idempotencyKey}
    )
    on conflict (tenant_id, idempotency_key) do update set updated_at = now()
    returning id, tenant_id, receipt_id, channel, destination, status, idempotency_key,
      attempt_count, provider_code, provider_message_id, last_error, sent_at
  `;
  return map(rows[0]);
}

export async function listDeliveries(tenantId: string, limit = 100) {
  const rows = await sql<DeliveryRow[]>`
    select id, tenant_id, receipt_id, channel, destination, status, idempotency_key,
      attempt_count, provider_code, provider_message_id, last_error, sent_at
    from receipt_deliveries
    where tenant_id = ${tenantId}
    order by created_at desc
    limit ${Math.min(Math.max(limit, 1), 200)}
  `;
  return rows.map(map);
}

export async function claimPendingDeliveries(tenantId: string, limit = 20) {
  const rows = await sql<DeliveryRow[]>`
    update receipt_deliveries
    set status = 'PROCESSING', attempt_count = attempt_count + 1, last_attempt_at = now(), updated_at = now()
    where id in (
      select id from receipt_deliveries
      where tenant_id = ${tenantId}
        and status in ('PENDING', 'FAILED')
        and next_attempt_at <= now()
      order by created_at asc
      limit ${Math.min(Math.max(limit, 1), 50)}
      for update skip locked
    )
    returning id, tenant_id, receipt_id, channel, destination, status, idempotency_key,
      attempt_count, provider_code, provider_message_id, last_error, sent_at
  `;
  return rows.map(map);
}

export async function markDeliverySent(tenantId: string, id: string, providerCode: string, providerMessageId?: string) {
  const rows = await sql<DeliveryRow[]>`
    update receipt_deliveries
    set status = 'SENT', sent_at = now(), provider_code = ${providerCode}, provider_message_id = ${providerMessageId ?? null}, last_error = null, updated_at = now()
    where tenant_id = ${tenantId} and id = ${id}
    returning id, tenant_id, receipt_id, channel, destination, status, idempotency_key,
      attempt_count, provider_code, provider_message_id, last_error, sent_at
  `;
  return rows[0] ? map(rows[0]) : null;
}

export async function markDeliveryFailed(tenantId: string, id: string, error: string, retryMinutes = 5) {
  const rows = await sql<DeliveryRow[]>`
    update receipt_deliveries
    set status = 'FAILED', last_error = ${error}, next_attempt_at = now() + (${retryMinutes}::text || ' minutes')::interval, updated_at = now()
    where tenant_id = ${tenantId} and id = ${id}
    returning id, tenant_id, receipt_id, channel, destination, status, idempotency_key,
      attempt_count, provider_code, provider_message_id, last_error, sent_at
  `;
  return rows[0] ? map(rows[0]) : null;
}

export async function releaseWaitingDeliveries(tenantId: string, receiptId: string) {
  await sql`
    update receipt_deliveries
    set status = 'PENDING', next_attempt_at = now(), updated_at = now()
    where tenant_id = ${tenantId} and receipt_id = ${receiptId} and status = 'WAITING_RECEIPT'
  `;
}
