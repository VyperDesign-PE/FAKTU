import { getQueue, patchReceipt } from "../storage/receiptQueue";
import { submitReceipt } from "./api";

const syncingScopes = new Set<string>();

export async function syncPendingReceipts(scope: string) {
  if (syncingScopes.has(scope)) return;
  syncingScopes.add(scope);

  try {
    const queue = await getQueue(scope);
    const pending = queue.filter((r) => r.status === "PENDING" || r.status === "ERROR");

    for (const receipt of pending) {
      await patchReceipt(scope, receipt.clientTransactionId, { status: "SYNCING", errorMessage: undefined });
      try {
        const result = await submitReceipt(receipt);
        if (result.status === "PENDING") {
          await patchReceipt(scope, receipt.clientTransactionId, {
            status: "PENDING",
            errorMessage: result.message ?? "El proveedor continúa procesando el comprobante."
          });
          continue;
        }

        if (!result.officialNumber) throw new Error("El proveedor no devolvió el número oficial del comprobante.");
        await patchReceipt(scope, receipt.clientTransactionId, {
          status: "ACCEPTED",
          officialNumber: result.officialNumber,
          errorMessage: undefined
        });
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
