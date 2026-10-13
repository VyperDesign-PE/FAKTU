import { sql } from "../db/client.js";
import type { BillingService } from "../modules/billing/BillingService.js";
import { processPendingReceipts } from "../modules/receipts/receiptIssuer.js";
import { processPendingVoidings } from "../modules/voidings/voidingService.js";
import { processPendingGuides } from "../modules/despatch/despatchService.js";
import { archivePendingFiles } from "../modules/receipts/archive.js";
import { checkAndAlertStuckDocuments, sendAlert } from "../modules/ops/alerts.js";

const ADVISORY_LOCK_ID = 727_001;

/**
 * Un ciclo de trabajo en segundo plano. Un candado de PostgreSQL asegura que,
 * aunque haya varios procesos (la API y/o workers dedicados), solo uno trabaja
 * a la vez; el estado de cada comprobante vive en la base, así que un reinicio
 * no pierde nada y el reintento continúa donde quedó.
 */
export async function runWorkerCycle(billingService: BillingService, log: (message: string, data?: unknown) => void = () => undefined) {
  await sql.begin(async (tx) => {
    const [{ locked }] = await tx<{ locked: boolean }[]>`select pg_try_advisory_xact_lock(${ADVISORY_LOCK_ID}) as locked`;
    if (!locked) return;
    const processed = [
      ...await processPendingReceipts(billingService),
      ...await processPendingVoidings(billingService),
      ...await processPendingGuides(billingService)
    ];
    if (processed.length) log("pending documents processed", processed);
    const archived = await archivePendingFiles();
    if (archived) log("provider files archived", archived);
    await checkAndAlertStuckDocuments();
  });
}

export function startWorker(billingService: BillingService, log: (message: string, data?: unknown) => void = () => undefined, onError: (error: unknown) => void = () => undefined) {
  const intervalMs = Number(process.env.RECEIPT_WORKER_INTERVAL_MS ?? 60_000);
  if (!(intervalMs > 0)) return undefined;
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try { await runWorkerCycle(billingService, log); } catch (error) {
      onError(error);
      await sendAlert("worker", `El worker falló: ${error instanceof Error ? error.message : String(error)}`);
    } finally { running = false; }
  }, intervalMs);
  timer.unref();
  return timer;
}
