import { sql } from "../../db/client.js";
import type { BillingService } from "../billing/BillingService.js";
import { releaseWaitingDeliveries } from "../delivery/deliveryRepository.js";
import {
  applyBillingResult,
  buildBillingCommand,
  claimReceiptForSending,
  getReceiptById,
  isFinalStatus,
  markReceiptError,
  type ReceiptRecord
} from "./receiptRepository.js";

export type IssueOutcome = {
  receipt: ReceiptRecord;
  /** true cuando la emisión falló antes de obtener respuesta del proveedor. */
  failed?: boolean;
};

async function storeResult(tenantId: string, receiptId: string, result: Awaited<ReturnType<BillingService["issueDocument"]>>) {
  const stored = await applyBillingResult(tenantId, receiptId, result);
  if (stored.status === "ACEPTADO") await releaseWaitingDeliveries(tenantId, stored.id);
  return stored;
}

/**
 * Emite o concilia un comprobante de forma segura ante reintentos:
 *
 * 1. Si ya hubo un intento previo, el proveedor pudo haber recibido el
 *    documento aunque perdimos la respuesta: primero se consulta el estado.
 * 2. Solo si el estado sigue sin confirmarse se reenvía, y siempre con la
 *    MISMA serie y correlativo, por lo que nunca nace un segundo comprobante.
 * 3. El envío se reserva atómicamente: dos peticiones simultáneas (por ejemplo
 *    la cola offline y el usuario tocando "reintentar") no envían en paralelo.
 */
export async function issueOrReconcileReceipt(billingService: BillingService, tenantId: string, receiptId: string): Promise<IssueOutcome> {
  const receipt = await getReceiptById(tenantId, receiptId);
  if (!receipt) throw new Error("Comprobante no encontrado");
  if (isFinalStatus(receipt.status)) return { receipt };

  if (receipt.attemptCount > 0) {
    const status = await billingService.reconcileDocument(await buildBillingCommand(receipt));
    if (status.status !== "PENDING") return { receipt: await storeResult(tenantId, receipt.id, status) };
  }

  const claimed = await claimReceiptForSending(tenantId, receipt.id);
  if (!claimed) {
    // Otro proceso lo está enviando en este momento: devolvemos el estado actual.
    return { receipt: (await getReceiptById(tenantId, receipt.id)) ?? receipt };
  }

  let result;
  try {
    result = await billingService.issueDocument(await buildBillingCommand(claimed));
  } catch (error) {
    const message = error instanceof Error ? error.message : "No pudimos enviar el comprobante.";
    return { receipt: await markReceiptError(tenantId, claimed.id, message), failed: true };
  }
  // Si este guardado falla, el comprobante queda ENVIANDO y el próximo intento
  // concilia primero (attemptCount > 0) en vez de reemitir a ciegas.
  return { receipt: await storeResult(tenantId, claimed.id, result) };
}

/**
 * Reintentos del lado del servidor: concilia o reenvía comprobantes que
 * quedaron pendientes, sin depender de que el celular vuelva a abrirse.
 */
export async function processPendingReceipts(billingService: BillingService, options: { limit?: number; maxAttempts?: number } = {}) {
  const limit = options.limit ?? 20;
  const maxAttempts = options.maxAttempts ?? Number(process.env.RECEIPT_MAX_ATTEMPTS ?? 12);
  const rows = await sql<{ id: string; tenant_id: string }[]>`
    select id, tenant_id
    from receipts
    where sunat_status in ('PENDIENTE', 'ENVIANDO', 'ERROR', 'OBSERVADO')
      and attempt_count < ${maxAttempts}
      -- backoff exponencial: 1, 2, 4, 8... minutos (máx. 60) desde el último intento
      and (last_attempt_at is null or last_attempt_at < now() - make_interval(mins => least(60, power(2, greatest(attempt_count - 1, 0))::int)))
      and created_at < now() - interval '30 seconds'
    order by last_attempt_at nulls first, created_at
    limit ${limit}
  `;
  const processed: Array<{ id: string; status: string }> = [];
  for (const row of rows) {
    try {
      const outcome = await issueOrReconcileReceipt(billingService, row.tenant_id, row.id);
      processed.push({ id: row.id, status: outcome.receipt.status });
    } catch (error) {
      processed.push({ id: row.id, status: `ERROR: ${error instanceof Error ? error.message : "desconocido"}` });
    }
  }
  return processed;
}
