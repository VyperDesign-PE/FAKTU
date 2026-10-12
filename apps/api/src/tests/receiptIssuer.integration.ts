/**
 * Prueba de integración contra PostgreSQL real de la emisión segura de
 * comprobantes. Usa un proveedor falso para provocar los casos difíciles:
 * respuesta perdida, envíos concurrentes y respuestas tardías.
 *
 * Requiere DATABASE_URL apuntando a una base de pruebas y ALLOW_DB_TESTS=true.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { closeDatabase, sql } from "../db/client.js";
import { runMigrations } from "../db/migrations.js";
import type { BillingService } from "../modules/billing/BillingService.js";
import type { BillingIssueResult, IssueDocumentCommand } from "../modules/billing/contracts.js";
import { issueOrReconcileReceipt, processPendingReceipts } from "../modules/receipts/receiptIssuer.js";
import { applyBillingResult, getReceiptById, prepareReceipt } from "../modules/receipts/receiptRepository.js";

if (process.env.ALLOW_DB_TESTS !== "true") throw new Error("ALLOW_DB_TESTS=true es obligatorio (la prueba escribe en la base).");

type Behaviour = {
  issue?: (command: IssueDocumentCommand) => Promise<BillingIssueResult>;
  reconcile?: (command: IssueDocumentCommand) => Promise<BillingIssueResult>;
};

function fakeBilling(behaviour: Behaviour) {
  const calls = { issue: 0, reconcile: 0, issuedNumbers: [] as string[] };
  const service = {
    async issueDocument(command: IssueDocumentCommand) {
      calls.issue += 1;
      calls.issuedNumbers.push(`${command.series}-${command.correlative}`);
      return behaviour.issue ? behaviour.issue(command) : accepted(command);
    },
    async reconcileDocument(command: IssueDocumentCommand) {
      calls.reconcile += 1;
      return behaviour.reconcile ? behaviour.reconcile(command) : pending(command);
    },
    async health() {
      return { providerCode: "mock", status: "UP" as const };
    }
  } as unknown as BillingService;
  return { service, calls };
}

const accepted = (command: IssueDocumentCommand): BillingIssueResult => ({
  providerCode: "mock", status: "ACCEPTED", officialNumber: `${command.series}-${command.correlative}`, message: "Aceptado"
});
const pending = (command: IssueDocumentCommand): BillingIssueResult => ({
  providerCode: "mock", status: "PENDING", officialNumber: `${command.series}-${command.correlative}`, message: "Sin respuesta"
});

async function createTenant() {
  const tenantId = randomUUID();
  await sql`insert into tenants (id, display_name) values (${tenantId}, 'Negocio prueba issuer')`;
  return tenantId;
}

async function newReceipt(tenantId: string) {
  const prepared = await prepareReceipt({
    tenantId,
    clientTransactionId: `tx-issuer-${randomUUID()}`,
    temporaryNumber: "VT-TEST",
    documentType: "BOLETA",
    total: 3,
    items: [1, 2, 3].map((n) => ({ id: `p${n}`, name: `Item ${n}`, quantity: 1, unitPrice: 1 }))
  });
  return prepared.receipt;
}

async function setState(receiptId: string, status: string, attempts: number, minutesAgo = 0) {
  await sql`
    update receipts
    set sunat_status = ${status}, attempt_count = ${attempts},
        last_attempt_at = now() - make_interval(mins => ${minutesAgo}),
        created_at = now() - interval '1 hour'
    where id = ${receiptId}
  `;
}

const cases: Array<[string, () => Promise<void>]> = [
  ["los montos guardados se recalculan y cuadran con las líneas", async () => {
    const tenantId = await createTenant();
    const receipt = await newReceipt(tenantId);
    assert.deepEqual([receipt.subtotal, receipt.igv, receipt.total], [2.55, 0.45, 3]);
    const [sums] = await sql<{ subtotal: string; igv: string; total: string }[]>`
      select sum(line_subtotal) as subtotal, sum(line_igv) as igv, sum(line_total) as total
      from receipt_items where receipt_id = ${receipt.id}
    `;
    assert.deepEqual([Number(sums.subtotal), Number(sums.igv), Number(sums.total)], [2.55, 0.45, 3]);
  }],

  ["primer envío: emite una vez y queda ACEPTADO", async () => {
    const tenantId = await createTenant();
    const receipt = await newReceipt(tenantId);
    const { service, calls } = fakeBilling({});
    const outcome = await issueOrReconcileReceipt(service, tenantId, receipt.id);
    assert.equal(outcome.receipt.status, "ACEPTADO");
    assert.equal(calls.issue, 1);
    assert.equal(calls.reconcile, 0);
  }],

  ["reintento tras ERROR: concilia primero y NO reemite si ya fue aceptado", async () => {
    const tenantId = await createTenant();
    const receipt = await newReceipt(tenantId);
    await setState(receipt.id, "ERROR", 1);
    const { service, calls } = fakeBilling({ reconcile: async (command) => accepted(command) });
    const outcome = await issueOrReconcileReceipt(service, tenantId, receipt.id);
    assert.equal(outcome.receipt.status, "ACEPTADO");
    assert.equal(calls.reconcile, 1);
    assert.equal(calls.issue, 0, "No debe volver a enviar un comprobante que el proveedor ya aceptó");
  }],

  ["reintento sin confirmación: reenvía con la MISMA serie y correlativo", async () => {
    const tenantId = await createTenant();
    const receipt = await newReceipt(tenantId);
    await setState(receipt.id, "PENDIENTE", 1, 10);
    const { service, calls } = fakeBilling({});
    const outcome = await issueOrReconcileReceipt(service, tenantId, receipt.id);
    assert.equal(outcome.receipt.status, "ACEPTADO");
    assert.deepEqual(calls.issuedNumbers, [`${receipt.series}-${receipt.correlative}`]);
    const [{ count }] = await sql<{ count: string }[]>`select count(*) from receipts where tenant_id = ${tenantId}`;
    assert.equal(Number(count), 1, "No debe crearse otro comprobante");
  }],

  ["dos envíos simultáneos: solo uno llega al proveedor", async () => {
    const tenantId = await createTenant();
    const receipt = await newReceipt(tenantId);
    const { service, calls } = fakeBilling({
      issue: async (command) => {
        await new Promise((resolve) => setTimeout(resolve, 300));
        return accepted(command);
      }
    });
    const [a, b] = await Promise.all([
      issueOrReconcileReceipt(service, tenantId, receipt.id),
      issueOrReconcileReceipt(service, tenantId, receipt.id)
    ]);
    assert.equal(calls.issue, 1);
    assert.ok([a.receipt.status, b.receipt.status].includes("ACEPTADO"));
    assert.equal((await getReceiptById(tenantId, receipt.id))?.status, "ACEPTADO");
  }],

  ["una respuesta tardía PENDING no degrada un comprobante ACEPTADO", async () => {
    const tenantId = await createTenant();
    const receipt = await newReceipt(tenantId);
    const { service } = fakeBilling({});
    await issueOrReconcileReceipt(service, tenantId, receipt.id);
    const late = await applyBillingResult(tenantId, receipt.id, { providerCode: "mock", status: "PENDING", message: "tarde" });
    assert.equal(late.status, "ACEPTADO");
  }],

  ["falla antes de obtener respuesta: queda ERROR y no se pierde la venta", async () => {
    const tenantId = await createTenant();
    const receipt = await newReceipt(tenantId);
    const { service } = fakeBilling({ issue: async () => { throw new Error("credencial inválida"); } });
    const outcome = await issueOrReconcileReceipt(service, tenantId, receipt.id);
    assert.equal(outcome.failed, true);
    assert.equal(outcome.receipt.status, "ERROR");
    assert.equal(outcome.receipt.attemptCount, 1);
  }],

  ["el proceso del servidor recupera comprobantes pendientes", async () => {
    const tenantId = await createTenant();
    const receipt = await newReceipt(tenantId);
    await setState(receipt.id, "ENVIANDO", 1, 30);
    const { service, calls } = fakeBilling({ reconcile: async (command) => accepted(command) });
    await processPendingReceipts(service, { limit: 500 });
    assert.equal((await getReceiptById(tenantId, receipt.id))?.status, "ACEPTADO");
    assert.equal(calls.issue, 0);
  }]
];

await runMigrations();
let failed = 0;
for (const [name, fn] of cases) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  ✗ ${name}\n    ${error instanceof Error ? error.stack : String(error)}`);
  }
}
await closeDatabase();
console.log(failed ? `ISSUER INTEGRATION: ${failed} FAILED` : `ISSUER INTEGRATION: ${cases.length} PASS`);
process.exit(failed ? 1 : 0);
