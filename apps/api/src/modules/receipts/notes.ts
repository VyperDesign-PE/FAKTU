import { randomUUID } from "node:crypto";
import { sql } from "../../db/client.js";
import {
  CREDIT_NOTE_REASONS,
  DEBIT_NOTE_REASONS,
  TOTAL_CREDIT_NOTE_REASONS,
  isNoteType,
  type CreditNoteReasonCode,
  type DebitNoteReasonCode
} from "../billing/contracts.js";
import { getReceiptById, prepareReceipt, type ReceiptItemInput, type ReceiptRecord } from "./receiptRepository.js";
import { priceItems } from "./pricing.js";
import type { TransactionSql } from "postgres";

export class NoteError extends Error {
  constructor(readonly code: string, message: string, readonly statusCode = 409) {
    super(message);
    this.name = "NoteError";
  }
}

export type CreditNoteRequest = {
  reasonCode: CreditNoteReasonCode;
  /** Sustento que verá SUNAT y el cliente. */
  description?: string;
  /** 07 devolución por ítem: líneas del comprobante original y cantidad devuelta. */
  items?: Array<{ lineIndex: number; quantity: number }>;
  /** 09 disminución en el valor: monto total (con IGV) a rebajar. */
  amount?: number;
  /** Clave idempotente para notas parciales (la genera la app). */
  clientTransactionId?: string;
};

export type DebitNoteRequest = {
  reasonCode: DebitNoteReasonCode;
  description?: string;
  /** Cargos adicionales (con IGV). */
  items: Array<{ name: string; quantity: number; unitPrice: number }>;
  clientTransactionId?: string;
};

const cents = (value: number) => Math.round(value * 100);

function assertNotVoidedByCreditNote(original: ReceiptRecord) {
  if (original.creditNote && original.creditNote.status !== "RECHAZADO") {
    throw new NoteError("ALREADY_VOIDED", "Este comprobante ya fue anulado con una nota de crédito.");
  }
}

async function loadModifiableReceipt(tenantId: string, originalId: string) {
  const original = await getReceiptById(tenantId, originalId);
  if (!original) throw new NoteError("NOT_FOUND", "Comprobante no encontrado", 404);
  if (isNoteType(original.documentType)) {
    throw new NoteError("NOT_MODIFIABLE", "Las notas se emiten sobre boletas o facturas, no sobre otras notas.");
  }
  if (original.status !== "ACEPTADO") {
    throw new NoteError("NOT_ACCEPTED", "Solo se pueden modificar comprobantes aceptados por SUNAT.");
  }
  if (original.voiding && original.voiding.status !== "RECHAZADO") {
    throw new NoteError("VOIDED", "Este comprobante tiene una comunicación de baja; ya no admite notas.");
  }
  return original as ReceiptRecord & { documentType: "BOLETA" | "FACTURA" };
}

/** Cantidad ya devuelta por línea (notas 07 no rechazadas), dentro de la transacción. */
async function returnedQuantities(tx: TransactionSql<Record<string, unknown>>, originalId: string) {
  const rows = await tx<{ product_ref: string | null; description: string; unit_price: string; quantity: string }[]>`
    select i.product_ref, i.description, i.unit_price, sum(i.quantity) as quantity
    from receipt_items i
    join receipts n on n.id = i.receipt_id
    where n.related_receipt_id = ${originalId} and n.document_type = 'NOTA_CREDITO'
      and n.note_reason_code = '07' and n.sunat_status <> 'RECHAZADO'
    group by i.product_ref, i.description, i.unit_price
  `;
  return rows;
}

function lineKey(item: { id?: string | null; name: string; unitPrice: number }) {
  return `${item.id ?? ""}|${item.name}|${Number(item.unitPrice).toFixed(6)}`;
}

/**
 * Prepara una nota de crédito.
 *
 * - 01 / 02 / 06 (anulación o devolución total): por el total del comprobante;
 *   solo si no hay notas de crédito previas. Idempotente: repetirla devuelve la
 *   misma nota. 02 (error en el RUC) solo aplica a facturas.
 * - 07 (devolución por ítem): líneas y cantidades devueltas, sin superar lo vendido.
 * - 09 (disminución en el valor): un monto, sin superar el saldo acreditable.
 */
export async function prepareCreditNote(tenantId: string, originalId: string, request: CreditNoteRequest) {
  const original = await loadModifiableReceipt(tenantId, originalId);
  const reasonLabel = CREDIT_NOTE_REASONS[request.reasonCode];
  if (!reasonLabel) throw new NoteError("INVALID_REASON", "Motivo de nota de crédito no soportado.", 422);
  const description = (request.description?.trim() || reasonLabel).toUpperCase().slice(0, 250);
  const isTotal = TOTAL_CREDIT_NOTE_REASONS.includes(request.reasonCode);

  if (request.reasonCode === "02" && original.documentType !== "FACTURA") {
    throw new NoteError("RUC_ERROR_ONLY_FACTURA", "La anulación por error en el RUC solo aplica a facturas.", 422);
  }

  let items: ReceiptItemInput[];
  let clientTransactionId: string;
  if (!isTotal) assertNotVoidedByCreditNote(original);

  if (isTotal) {
    if (original.creditNote && original.creditNote.status !== "RECHAZADO") {
      const existing = await getReceiptById(tenantId, original.creditNote.id);
      if (existing) return { receipt: existing, created: false };
    }
    if (original.creditedTotal > 0) {
      throw new NoteError("HAS_PARTIAL_CREDITS", "Este comprobante ya tiene devoluciones o descuentos. Usa una devolución por ítem para el saldo restante.");
    }
    items = original.items ?? [];
    // Si SUNAT rechazó una nota total anterior, el nuevo intento usa otra clave.
    const [{ rejected }] = await sql<{ rejected: number }[]>`
      select count(*)::int as rejected from receipts
      where tenant_id = ${tenantId} and related_receipt_id = ${original.id}
        and document_type = 'NOTA_CREDITO' and note_reason_code in ('01', '02', '06') and sunat_status = 'RECHAZADO'
    `;
    clientTransactionId = rejected ? `nc-${original.id}-r${rejected}` : `nc-${original.id}`;
  } else if (request.reasonCode === "07") {
    if (!request.items?.length) throw new NoteError("ITEMS_REQUIRED", "Indica qué productos y cuántos se devuelven.", 422);
    const originalItems = original.items ?? [];
    items = request.items.map((selected) => {
      const line = originalItems[selected.lineIndex];
      if (!line) throw new NoteError("INVALID_LINE", "Uno de los productos no pertenece al comprobante.", 422);
      if (!(selected.quantity > 0) || selected.quantity > line.quantity) {
        throw new NoteError("INVALID_QUANTITY", `La cantidad devuelta de ${line.name} no es válida.`, 422);
      }
      return { id: line.id, name: line.name, quantity: selected.quantity, unitPrice: line.unitPrice, unit: line.unit };
    });
    clientTransactionId = request.clientTransactionId ?? `nc-${original.id}-${randomUUID()}`;
  } else {
    const amount = Math.round((request.amount ?? 0) * 100) / 100;
    if (!(amount > 0)) throw new NoteError("AMOUNT_REQUIRED", "Indica el monto a rebajar.", 422);
    items = [{ id: "DISMINUCION", name: `DISMINUCION EN EL VALOR: ${description}`.slice(0, 250), quantity: 1, unitPrice: amount, unit: "ZZ" }];
    clientTransactionId = request.clientTransactionId ?? `nc-${original.id}-${randomUUID()}`;
  }

  const noteTotal = priceItems(items).total;

  return prepareReceipt({
    tenantId,
    clientTransactionId,
    temporaryNumber: `NC-${original.series}-${original.correlative}`,
    documentType: "NOTA_CREDITO",
    customer: original.customer,
    items,
    total: noteTotal,
    paymentMethod: original.paymentMethod,
    relatedReceiptId: original.id,
    relatedDocumentType: original.documentType,
    noteReasonCode: request.reasonCode,
    noteDescription: description,
    practice: original.practice,
    // Dentro de la transacción: bloquea el original y valida el saldo, para que
    // dos devoluciones simultáneas no acrediten más de lo vendido.
    guard: async (tx) => {
      await tx`select id from receipts where id = ${original.id} for update`;
      const [balance] = await tx<{ credited: string; debited: string }[]>`
        select
          coalesce(sum(total) filter (where document_type = 'NOTA_CREDITO'), 0) as credited,
          coalesce(sum(total) filter (where document_type = 'NOTA_DEBITO'), 0) as debited
        from receipts
        where related_receipt_id = ${original.id} and sunat_status <> 'RECHAZADO'
      `;
      if (request.reasonCode === "07") {
        const returned = new Map((await returnedQuantities(tx, original.id)).map((row) => [
          lineKey({ id: row.product_ref, name: row.description, unitPrice: Number(row.unit_price) }),
          Number(row.quantity)
        ]));
        const requested = new Map<string, number>();
        for (const item of items) requested.set(lineKey(item), (requested.get(lineKey(item)) ?? 0) + item.quantity);
        for (const line of original.items ?? []) {
          const key = lineKey(line);
          if (!requested.has(key)) continue;
          if ((returned.get(key) ?? 0) + (requested.get(key) ?? 0) > line.quantity + 1e-9) {
            throw new NoteError("EXCEEDS_QUANTITY", `Ya se devolvió todo o parte de ${line.name}; la cantidad supera lo vendido.`, 422);
          }
        }
      }
      const available = cents(original.total) + cents(Number(balance.debited)) - cents(Number(balance.credited));
      if (cents(noteTotal) > available) {
        throw new NoteError("EXCEEDS_BALANCE", `La nota (S/ ${noteTotal.toFixed(2)}) supera el saldo del comprobante (S/ ${(available / 100).toFixed(2)}).`, 422);
      }
    }
  });
}

/** Prepara una nota de débito (cargos adicionales sobre un comprobante aceptado). */
export async function prepareDebitNote(tenantId: string, originalId: string, request: DebitNoteRequest) {
  const original = await loadModifiableReceipt(tenantId, originalId);
  assertNotVoidedByCreditNote(original);
  const reasonLabel = DEBIT_NOTE_REASONS[request.reasonCode];
  if (!reasonLabel) throw new NoteError("INVALID_REASON", "Motivo de nota de débito no soportado.", 422);
  if (!request.items.length) throw new NoteError("ITEMS_REQUIRED", "Indica el concepto y el monto del cargo.", 422);
  const description = (request.description?.trim() || reasonLabel).toUpperCase().slice(0, 250);
  const items: ReceiptItemInput[] = request.items.map((item, index) => ({
    id: `CARGO-${index + 1}`,
    name: item.name.trim().slice(0, 250),
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    unit: "ZZ"
  }));
  const total = priceItems(items).total;
  if (!(total > 0)) throw new NoteError("AMOUNT_REQUIRED", "El monto de la nota de débito debe ser mayor a cero.", 422);

  return prepareReceipt({
    tenantId,
    clientTransactionId: request.clientTransactionId ?? `nd-${original.id}-${randomUUID()}`,
    temporaryNumber: `ND-${original.series}-${original.correlative}`,
    documentType: "NOTA_DEBITO",
    customer: original.customer,
    items,
    total,
    paymentMethod: original.paymentMethod,
    relatedReceiptId: original.id,
    relatedDocumentType: original.documentType,
    noteReasonCode: request.reasonCode,
    noteDescription: description,
    practice: original.practice,
    guard: async (tx) => {
      await tx`select id from receipts where id = ${original.id} for update`;
    }
  });
}
