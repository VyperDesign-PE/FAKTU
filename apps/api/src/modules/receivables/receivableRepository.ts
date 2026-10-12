import { randomUUID } from "node:crypto";
import { sql } from "../../db/client.js";
import { PAYMENT_METHODS, type PaymentMethod } from "../billing/contracts.js";

export class ReceivableError extends Error {
  constructor(readonly code: string, message: string, readonly status = 422) {
    super(message);
    this.name = "ReceivableError";
  }
}

export type OpenReceivable = {
  receiptId: string;
  clientTransactionId: string;
  number: string;
  issueDate: string;
  total: number;
  paid: number;
  balance: number;
  customerName: string;
  customerDocument?: string;
  customerPhone?: string;
};

type Row = {
  id: string; client_transaction_id: string; series: string; correlative: string | number; official_number: string | null;
  issue_date: Date; total: string; paid: string | null; customer_name: string | null; customer_document_number: string | null;
  phone: string | null;
};

/**
 * Ventas fiadas con saldo pendiente. Las ventas anuladas (nota de crédito total
 * o baja aceptada) y las rechazadas por SUNAT no se cobran.
 */
export async function listOpenReceivables(tenantId: string): Promise<OpenReceivable[]> {
  const rows = await sql<Row[]>`
    select r.id, r.client_transaction_id, r.series, r.correlative, r.official_number, r.issue_date, r.total,
           r.customer_name, r.customer_document_number, c.phone,
           (select coalesce(sum(p.amount), 0) from receivable_payments p where p.receipt_id = r.id) as paid
    from receipts r
    left join customers c on c.id = r.customer_id
    where r.tenant_id = ${tenantId}
      and r.payment_method = 'CREDITO'
      and r.document_type in ('BOLETA', 'FACTURA')
      and r.sunat_status <> 'RECHAZADO'
      and not exists (
        select 1 from receipts n where n.related_receipt_id = r.id and n.document_type = 'NOTA_CREDITO'
          and n.sunat_status = 'ACEPTADO' and n.note_reason_code in ('01', '02', '06')
      )
      and not exists (select 1 from receipt_voidings v where v.receipt_id = r.id and v.status = 'ACEPTADO')
    order by r.issue_date asc
  `;
  return rows
    .map((row) => {
      const total = Number(row.total);
      const paid = Number(row.paid ?? 0);
      return {
        receiptId: row.id,
        clientTransactionId: row.client_transaction_id,
        number: row.official_number ?? `${row.series}-${String(row.correlative).padStart(8, "0")}`,
        issueDate: row.issue_date.toISOString(),
        total,
        paid,
        balance: Math.round((total - paid) * 100) / 100,
        customerName: row.customer_name ?? "Cliente",
        customerDocument: row.customer_document_number ?? undefined,
        customerPhone: row.phone ?? undefined
      };
    })
    .filter((item) => item.balance > 0.004);
}

/** Registra un abono. El saldo se verifica con el comprobante bloqueado para evitar cobros dobles. */
export async function registerReceivablePayment(input: {
  tenantId: string;
  receiptId: string;
  amount: number;
  method: PaymentMethod;
  note?: string;
}) {
  if (input.method === "CREDITO" || !PAYMENT_METHODS.includes(input.method)) {
    throw new ReceivableError("INVALID_METHOD", "Elige cómo pagó el cliente (efectivo, Yape, Plin...).");
  }
  const amount = Math.round(input.amount * 100) / 100;
  if (!(amount > 0)) throw new ReceivableError("INVALID_AMOUNT", "El abono debe ser mayor a cero.");

  return sql.begin(async (tx) => {
    const rows = await tx<{ id: string; total: string }[]>`
      select id, total from receipts
      where id = ${input.receiptId} and tenant_id = ${input.tenantId} and payment_method = 'CREDITO'
      for update
    `;
    if (!rows[0]) throw new ReceivableError("NOT_FOUND", "No encontramos esa venta fiada.", 404);
    const paid = await tx<{ paid: string }[]>`
      select coalesce(sum(amount), 0) as paid from receivable_payments where receipt_id = ${input.receiptId}
    `;
    const balance = Math.round((Number(rows[0].total) - Number(paid[0].paid)) * 100) / 100;
    if (amount > balance + 0.004) {
      throw new ReceivableError("EXCEEDS_BALANCE", `El abono supera el saldo pendiente (S/ ${balance.toFixed(2)}).`);
    }
    await tx`
      insert into receivable_payments (id, tenant_id, receipt_id, amount, method, note)
      values (${randomUUID()}, ${input.tenantId}, ${input.receiptId}, ${amount}, ${input.method}, ${input.note?.slice(0, 200) ?? null})
    `;
    return { balance: Math.round((balance - amount) * 100) / 100 };
  });
}

export async function listReceivablePayments(tenantId: string, receiptId: string) {
  const rows = await sql<{ id: string; amount: string; method: string; note: string | null; created_at: Date }[]>`
    select id, amount, method, note, created_at from receivable_payments
    where tenant_id = ${tenantId} and receipt_id = ${receiptId} order by created_at asc
  `;
  return rows.map((row) => ({ id: row.id, amount: Number(row.amount), method: row.method, note: row.note ?? undefined, createdAt: row.created_at.toISOString() }));
}
