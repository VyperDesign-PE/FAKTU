import { isFinalReceiptStatus } from "../domain/types";
import { getQueue, patchReceipt } from "../storage/receiptQueue";
import { submitReceipt } from "./api";

const syncingScopes = new Set<string>();

export async function syncPendingReceipts(scope: string) {
  if (syncingScopes.has(scope)) return;
  syncingScopes.add(scope);

  try {
    const queue = await getQueue(scope);
    // Incluye SYNCING: si la app se cerró en pleno envío, la venta no debe quedar
    // colgada. El servidor es idempotente por clientTransactionId.
    const pending = queue.filter((r) => !isFinalReceiptStatus(r.status));

    for (const receipt of pending) {
      await patchReceipt(scope, receipt.clientTransactionId, { status: "SYNCING", errorMessage: undefined });
      try {
        const result = await submitReceipt(receipt);
        switch (result.status) {
          case "ACCEPTED":
            await patchReceipt(scope, receipt.clientTransactionId, {
              status: "ACCEPTED",
              officialNumber: result.officialNumber,
              errorMessage: undefined
            });
            break;
          case "REJECTED":
            await patchReceipt(scope, receipt.clientTransactionId, {
              status: "REJECTED",
              officialNumber: result.officialNumber,
              errorMessage: result.message ?? "El comprobante fue rechazado."
            });
            break;
          case "PENDING":
            await patchReceipt(scope, receipt.clientTransactionId, {
              status: "PENDING",
              errorMessage: result.message ?? "El proveedor continúa procesando el comprobante."
            });
            break;
          default:
            await patchReceipt(scope, receipt.clientTransactionId, {
              status: "ERROR",
              errorMessage: result.message ?? "No pudimos emitir el comprobante. Se reintentará."
            });
        }
      } catch (error) {
        await patchReceipt(scope, receipt.clientTransactionId, {
          status: "ERROR",
          errorMessage: error instanceof Error ? error.message : "Error de envío"
        });
      }
    }
  } finally {
    syncingScopes.delete(scope);
  }
}
