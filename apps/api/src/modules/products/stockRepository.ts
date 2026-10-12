import { randomUUID } from "node:crypto";
import type { TransactionSql } from "postgres";
import { sql } from "../../db/client.js";
import type { BillingDocumentType } from "../billing/contracts.js";

type Tx = TransactionSql<Record<string, unknown>>;

/** Motivos de nota de crédito en los que la mercadería vuelve al negocio. */
const RESTOCK_NOTE_REASONS = new Set(["01", "02", "06", "07"]);

/** -1 descuenta stock (venta), 1 repone (anulación/devolución), 0 no mueve stock. */
export function stockDirectionFor(documentType: BillingDocumentType | string, noteReasonCode?: string): -1 | 0 | 1 {
  if (documentType === "BOLETA" || documentType === "FACTURA") return -1;
  if (documentType === "NOTA_CREDITO" && noteReasonCode && RESTOCK_NOTE_REASONS.has(noteReasonCode)) return 1;
  return 0;
}

/**
 * Mueve el stock de los productos con control de inventario. Nunca bloquea la
 * venta: un negocio real vende aunque el sistema diga 0; el stock negativo se
 * muestra como alerta para que lo corrijan.
 */
export async function applyStockForItems(tx: Tx, input: {
  tenantId: string;
  receiptId: string;
  direction: -1 | 1;
  items: Array<{ productRef: string; quantity: number }>;
}) {
  for (const item of input.items) {
    const delta = input.direction * item.quantity;
    const updated = await tx<{ id: string; stock_qty: string }[]>`
      update products set stock_qty = stock_qty + ${delta}, updated_at = now()
      where tenant_id = ${input.tenantId} and client_product_id = ${item.productRef} and stock_qty is not null
      returning id, stock_qty
    `;
    if (!updated[0]) continue;
    await tx`
      insert into stock_movements (id, tenant_id, product_id, delta, balance, reason, receipt_id)
      values (${randomUUID()}, ${input.tenantId}, ${updated[0].id}, ${delta}, ${updated[0].stock_qty},
              ${input.direction < 0 ? "VENTA" : "DEVOLUCION"}, ${input.receiptId})
    `;
  }
}

export type StockMovementRecord = {
  id: string;
  delta: number;
  balance: number;
  reason: string;
  note?: string;
  createdAt: string;
};

export class StockError extends Error {
  constructor(readonly code: string, message: string, readonly status = 422) {
    super(message);
    this.name = "StockError";
  }
}

/** Ajuste manual: ingreso de mercadería, conteo físico o activar el control. */
export async function adjustStock(input: {
  tenantId: string;
  clientProductId: string;
  mode: "SET" | "ADD";
  quantity: number;
  note?: string;
}) {
  return sql.begin(async (tx) => {
    const rows = await tx<{ id: string; stock_qty: string | null }[]>`
      select id, stock_qty from products
      where tenant_id = ${input.tenantId} and client_product_id = ${input.clientProductId} and active = true
      for update
    `;
    const product = rows[0];
    if (!product) throw new StockError("PRODUCT_NOT_FOUND", "No encontramos ese producto.", 404);
    const previous = product.stock_qty === null ? null : Number(product.stock_qty);
    if (input.mode === "ADD" && previous === null) {
      throw new StockError("STOCK_NOT_TRACKED", "Primero indica el stock inicial de este producto.");
    }
    const next = input.mode === "SET" ? input.quantity : (previous ?? 0) + input.quantity;
    const delta = next - (previous ?? 0);
    await tx`update products set stock_qty = ${next}, updated_at = now() where id = ${product.id}`;
    await tx`
      insert into stock_movements (id, tenant_id, product_id, delta, balance, reason, note)
      values (${randomUUID()}, ${input.tenantId}, ${product.id}, ${delta}, ${next},
              ${previous === null ? "INICIAL" : input.mode === "ADD" ? "INGRESO" : "AJUSTE"}, ${input.note?.slice(0, 200) ?? null})
    `;
    return { stockQty: next };
  });
}

export async function listStockMovements(tenantId: string, clientProductId: string, limit = 40): Promise<StockMovementRecord[]> {
  const rows = await sql<{ id: string; delta: string; balance: string; reason: string; note: string | null; created_at: Date }[]>`
    select m.id, m.delta, m.balance, m.reason, m.note, m.created_at
    from stock_movements m join products p on p.id = m.product_id
    where m.tenant_id = ${tenantId} and p.client_product_id = ${clientProductId}
    order by m.created_at desc limit ${limit}
  `;
  return rows.map((row) => ({
    id: row.id,
    delta: Number(row.delta),
    balance: Number(row.balance),
    reason: row.reason,
    note: row.note ?? undefined,
    createdAt: row.created_at.toISOString()
  }));
}
