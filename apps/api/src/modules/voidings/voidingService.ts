import { randomUUID } from "node:crypto";
import { sql } from "../../db/client.js";
import type { BillingService } from "../billing/BillingService.js";
import type { VoidingCommand, VoidingKind, VoidingResult } from "../billing/contracts.js";
import { getReceiptById, type ReceiptRecord } from "../receipts/receiptRepository.js";

/**
 * Comunicación de baja.
 *
 * - Facturas → comunicación de baja (RA). Boletas → resumen diario con estado
 *   "3" (RC). El proveedor (Nubefact) puede resolverlo internamente; APIsPERU
 *   usa voided/send o summary/send según el caso.
 * - Solo para comprobantes ACEPTADOS, sin notas de crédito/débito vigentes y
 *   dentro del plazo (por defecto 7 días calendario desde la emisión,
 *   configurable con VOIDING_MAX_DAYS). Fuera de plazo, o si el comprobante ya
 *   se entregó, corresponde una nota de crédito.
 * - SUNAT responde con un ticket: el estado se consulta después (proceso del
 *   servidor). Con ticket, nunca se reenvía: solo se consulta.
 */
export type VoidingStatus = "PENDIENTE" | "ENVIANDO" | "ACEPTADO" | "RECHAZADO" | "ERROR";

export type VoidingRecord = {
  id: string;
  tenantId: string;
  receiptId: string;
  kind: VoidingKind;
  reason: string;
  correlative: number;
  providerCode?: string;
  ticket?: string;
  status: VoidingStatus;
  message?: string;
  attemptCount: number;
  practice: boolean;
  createdAt: string;
  updatedAt: string;
};

type VoidingRow = {
  id: string;
  tenant_id: string;
  receipt_id: string;
  kind: VoidingKind;
  reason: string;
  correlative: string | number;
  provider_code: string | null;
  ticket: string | null;
  status: VoidingStatus;
  message: string | null;
  attempt_count: number;
  is_practice: boolean;
  created_at: Date | string;
  updated_at: Date | string;
};

export class VoidingError extends Error {
  constructor(readonly code: string, message: string, readonly statusCode = 409) {
    super(message);
    this.name = "VoidingError";
  }
}

const MAX_DAYS = () => Number(process.env.VOIDING_MAX_DAYS ?? 7);
const STALE_SENDING_SECONDS = Number(process.env.RECEIPT_STALE_SENDING_SECONDS ?? 120);

function mapVoiding(row: VoidingRow): VoidingRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    receiptId: row.receipt_id,
    kind: row.kind,
    reason: row.reason,
    correlative: Number(row.correlative),
    providerCode: row.provider_code ?? undefined,
    ticket: row.ticket ?? undefined,
    status: row.status,
    message: row.message ?? undefined,
    attemptCount: row.attempt_count,
    practice: row.is_practice,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
}

/** Fecha calendario de Lima (UTC-5) de un instante. */
function limaDay(value: Date | string) {
  return new Date(new Date(value).getTime() - 5 * 3600_000).toISOString().slice(0, 10);
}

export function daysSinceIssue(issueDate: string, now = new Date()) {
  const issued = Date.parse(`${limaDay(issueDate)}T00:00:00Z`);
  const today = Date.parse(`${limaDay(now)}T00:00:00Z`);
  return Math.round((today - issued) / 86_400_000);
}

export function voidingKindFor(receipt: Pick<ReceiptRecord, "documentType" | "series">): VoidingKind {
  return receipt.documentType === "FACTURA" ? "COMUNICACION_BAJA" : "RESUMEN_BAJA";
}

/** Motivos por los que el comprobante no puede darse de baja (vacío = sí puede). */
export function voidingBlockers(receipt: ReceiptRecord, now = new Date()): string[] {
  const blockers: string[] = [];
  if (receipt.documentType !== "BOLETA" && receipt.documentType !== "FACTURA") blockers.push("Solo se dan de baja boletas y facturas.");
  if (receipt.status !== "ACEPTADO") blockers.push("El comprobante debe estar aceptado por SUNAT.");
  if (receipt.creditedTotal > 0 || receipt.debitedTotal > 0 || (receipt.creditNote && receipt.creditNote.status !== "RECHAZADO")) {
    blockers.push("Tiene notas de crédito o débito asociadas.");
  }
  const days = daysSinceIssue(receipt.issueDate, now);
  if (days > MAX_DAYS()) blockers.push(`Pasaron ${days} días desde la emisión; el plazo es de ${MAX_DAYS()} días. Usa una nota de crédito.`);
  return blockers;
}

export async function getVoidingById(tenantId: string, voidingId: string) {
  const rows = await sql<VoidingRow[]>`select * from receipt_voidings where tenant_id = ${tenantId} and id = ${voidingId} limit 1`;
  return rows[0] ? mapVoiding(rows[0]) : null;
}

async function getActiveVoiding(tenantId: string, receiptId: string) {
  const rows = await sql<VoidingRow[]>`
    select * from receipt_voidings
    where tenant_id = ${tenantId} and receipt_id = ${receiptId} and status <> 'RECHAZADO'
    limit 1
  `;
  return rows[0] ? mapVoiding(rows[0]) : null;
}

/** Crea (o devuelve, si ya existe) la baja de un comprobante. Idempotente. */
export async function prepareVoiding(tenantId: string, receiptId: string, reason: string) {
  const existing = await getActiveVoiding(tenantId, receiptId);
  if (existing) return { voiding: existing, created: false };

  const receipt = await getReceiptById(tenantId, receiptId);
  if (!receipt) throw new VoidingError("NOT_FOUND", "Comprobante no encontrado", 404);
  const blockers = voidingBlockers(receipt);
  if (blockers.length) throw new VoidingError("NOT_VOIDABLE", blockers.join(" "), 422);

  const kind = voidingKindFor(receipt);
  const id = randomUUID();
  // Numeración del día (RA-/RC-AAAAMMDD-n): contador por tipo y fecha (MMDD).
  const dayKey = limaDay(new Date()).slice(5).replace("-", "");
  try {
    await sql.begin(async (tx) => {
      await tx`select id from receipts where id = ${receipt.id} for update`;
      await tx`
        insert into document_series (id, tenant_id, document_type, series, last_correlative)
        values (${randomUUID()}, ${tenantId}, ${kind}, ${dayKey}, 0)
        on conflict (tenant_id, document_type, series) do nothing
      `;
      const [sequence] = await tx<{ last_correlative: string }[]>`
        update document_series set last_correlative = last_correlative + 1, updated_at = now()
        where tenant_id = ${tenantId} and document_type = ${kind} and series = ${dayKey}
        returning last_correlative
      `;
      await tx`
        insert into receipt_voidings (id, tenant_id, receipt_id, kind, reason, correlative, is_practice)
        values (${id}, ${tenantId}, ${receipt.id}, ${kind}, ${reason.toUpperCase().slice(0, 100)}, ${Number(sequence.last_correlative)}, ${receipt.practice})
      `;
    });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      const concurrent = await getActiveVoiding(tenantId, receiptId);
      if (concurrent) return { voiding: concurrent, created: false };
    }
    throw error;
  }
  return { voiding: (await getVoidingById(tenantId, id))!, created: true };
}

function toCommand(voiding: VoidingRecord, receipt: ReceiptRecord): VoidingCommand {
  return {
    tenantId: voiding.tenantId,
    voidingId: voiding.id,
    kind: voiding.kind,
    correlative: voiding.correlative,
    reason: voiding.reason,
    practice: voiding.practice,
    communicationDate: voiding.createdAt,
    document: {
      documentType: receipt.documentType,
      series: receipt.series,
      correlative: receipt.correlative,
      issueDate: receipt.issueDate,
      customer: receipt.customer,
      subtotal: receipt.subtotal,
      igv: receipt.igv,
      total: receipt.total
    }
  };
}

async function claim(tenantId: string, voidingId: string) {
  const rows = await sql<{ id: string }[]>`
    update receipt_voidings
    set status = 'ENVIANDO', attempt_count = attempt_count + 1, last_attempt_at = now(), updated_at = now()
    where tenant_id = ${tenantId} and id = ${voidingId}
      and (status in ('PENDIENTE', 'ERROR')
        or (status = 'ENVIANDO' and (last_attempt_at is null or last_attempt_at < now() - make_interval(secs => ${STALE_SENDING_SECONDS}))))
    returning id
  `;
  return Boolean(rows[0]);
}

async function store(tenantId: string, voidingId: string, result: VoidingResult) {
  const status: VoidingStatus = result.status === "ACCEPTED" ? "ACEPTADO" : result.status === "REJECTED" ? "RECHAZADO" : "PENDIENTE";
  await sql`
    update receipt_voidings
    set status = ${status}, ticket = coalesce(${result.ticket ?? null}, ticket), provider_code = ${result.providerCode},
        message = ${result.message}, updated_at = now()
    where tenant_id = ${tenantId} and id = ${voidingId} and status not in ('ACEPTADO', 'RECHAZADO')
  `;
}

/**
 * Envía o consulta la baja. Con ticket: solo consulta. Sin ticket y con un
 * intento previo: consulta primero (Nubefact consulta por número) y solo si
 * sigue sin registrarse, reenvía.
 */
export async function processVoiding(billingService: BillingService, tenantId: string, voidingId: string) {
  const voiding = await getVoidingById(tenantId, voidingId);
  if (!voiding) throw new VoidingError("NOT_FOUND", "Baja no encontrada", 404);
  if (voiding.status === "ACEPTADO" || voiding.status === "RECHAZADO") return voiding;
  const receipt = await getReceiptById(tenantId, voiding.receiptId);
  if (!receipt) throw new VoidingError("NOT_FOUND", "Comprobante no encontrado", 404);
  if (!(await claim(tenantId, voidingId))) return (await getVoidingById(tenantId, voidingId))!;

  const command = toCommand(voiding, receipt);
  try {
    let result: VoidingResult;
    if (voiding.ticket || voiding.attemptCount > 0) {
      result = await billingService.voidingStatus(command, voiding.ticket);
      if (result.status === "PENDING" && !voiding.ticket && !result.ticket && voiding.providerCode !== "nubefact") {
        result = await billingService.requestVoiding(command);
      }
    } else {
      result = await billingService.requestVoiding(command);
    }
    await store(tenantId, voidingId, result);
  } catch (error) {
    await sql`
      update receipt_voidings set status = 'ERROR', message = ${error instanceof Error ? error.message : "Error al enviar la baja"}, updated_at = now()
      where tenant_id = ${tenantId} and id = ${voidingId} and status not in ('ACEPTADO', 'RECHAZADO')
    `;
  }
  return (await getVoidingById(tenantId, voidingId))!;
}

/** Proceso del servidor: consulta tickets pendientes con backoff. */
export async function processPendingVoidings(billingService: BillingService, options: { limit?: number; maxAttempts?: number } = {}) {
  const rows = await sql<{ id: string; tenant_id: string }[]>`
    select id, tenant_id from receipt_voidings
    where status in ('PENDIENTE', 'ENVIANDO', 'ERROR')
      and attempt_count < ${options.maxAttempts ?? Number(process.env.RECEIPT_MAX_ATTEMPTS ?? 12)}
      and (last_attempt_at is null or last_attempt_at < now() - make_interval(mins => least(60, power(2, greatest(attempt_count - 1, 0))::int)))
    order by last_attempt_at nulls first
    limit ${options.limit ?? 20}
  `;
  const processed: Array<{ id: string; status: string }> = [];
  for (const row of rows) {
    try {
      processed.push({ id: row.id, status: (await processVoiding(billingService, row.tenant_id, row.id)).status });
    } catch (error) {
      processed.push({ id: row.id, status: `ERROR: ${error instanceof Error ? error.message : "desconocido"}` });
    }
  }
  return processed;
}

export function voidingToApi(voiding: VoidingRecord) {
  return {
    id: voiding.id,
    receiptId: voiding.receiptId,
    kind: voiding.kind,
    reason: voiding.reason,
    status: voiding.status === "ACEPTADO" ? "ACCEPTED" : voiding.status === "RECHAZADO" ? "REJECTED" : voiding.status === "ERROR" ? "ERROR" : "PENDING",
    sunatStatus: voiding.status,
    ticket: voiding.ticket,
    message: voiding.message,
    practice: voiding.practice,
    createdAt: voiding.createdAt
  };
}
