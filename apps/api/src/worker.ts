/**
 * Proceso dedicado a reintentos y conciliación con SUNAT/proveedor:
 *   npm --workspace @app/api run worker
 * Úsalo con RECEIPT_WORKER_ENABLED=false en la API para separar la web del trabajo en segundo plano.
 */
import { runMigrations } from "./db/migrations.js";
import { BillingService } from "./modules/billing/BillingService.js";
import { startSecretCacheRefresh } from "./modules/security/vault.js";
import { startWorker } from "./jobs/workerLoop.js";

if ((process.env.DB_AUTO_MIGRATE ?? "true").toLowerCase() === "true") await runMigrations();
startSecretCacheRefresh();
const billingService = new BillingService();
startWorker(
  billingService,
  (message, data) => console.log(JSON.stringify({ level: 30, msg: message, data })),
  (error) => console.error(JSON.stringify({ level: 50, msg: "worker cycle failed", error: error instanceof Error ? error.message : String(error) }))
);
console.log(JSON.stringify({ level: 30, msg: "worker started" }));
// Mantiene vivo el proceso (el temporizador es unref para no bloquear el cierre de la API).
setInterval(() => undefined, 1 << 30);
