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
import { NoteError, prepareCreditNote, prepareDebitNote } from "../modules/receipts/notes.js";
import { prepareVoiding, processVoiding, VoidingError } from "../modules/voidings/voidingService.js";
import { prepareGuide, processGuide } from "../modules/despatch/despatchService.js";
import type { DespatchCommand, VoidingCommand } from "../modules/billing/contracts.js";

if (process.env.ALLOW_DB_TESTS !== "true") throw new Error("ALLOW_DB_TESTS=true es obligatorio (la prueba escribe en la base).");

type Behaviour = {
  issue?: (command: IssueDocumentCommand) => Promise<BillingIssueResult>;
  reconcile?: (command: IssueDocumentCommand) => Promise<BillingIssueResult>;
  voidingStatus?: "PENDING" | "ACCEPTED" | "REJECTED";
};

function fakeBilling(behaviour: Behaviour) {
  const calls = { issue: 0, reconcile: 0, issuedNumbers: [] as string[], voidingRequests: 0, voidingChecks: 0, despatchSends: 0, despatchChecks: 0 };
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
    },
    async requestVoiding(_command: VoidingCommand) {
      calls.voidingRequests += 1;
      return { providerCode: "mock", status: "PENDING", ticket: "TICKET-1", message: "enviada" };
    },
    async voidingStatus(_command: VoidingCommand, ticket?: string) {
      calls.voidingChecks += 1;
      return { providerCode: "mock", status: behaviour.voidingStatus ?? "ACCEPTED", ticket, message: "consultada" };
    },
    async issueDespatch(_command: DespatchCommand) {
      calls.despatchSends += 1;
      return { providerCode: "mock", status: "PENDING", ticket: "GRE-1", message: "enviada" };
    },
    async despatchStatus(_command: DespatchCommand, ticket?: string) {
      calls.despatchChecks += 1;
      return { providerCode: "mock", status: "ACCEPTED", ticket, message: "aceptada" };
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

  ["anulación: una nota de crédito rechazada permite reintentar; la vigente es única", async () => {
    const tenantId = await createTenant();
    const sale = await newReceipt(tenantId);
    await issueOrReconcileReceipt(fakeBilling({}).service, tenantId, sale.id);

    const first = await prepareCreditNote(tenantId, sale.id, { reasonCode: "01", description: "DEVOLUCION" });
    assert.equal(first.receipt.documentType, "NOTA_CREDITO");
    const rejecting = fakeBilling({ issue: async () => ({ providerCode: "mock", status: "REJECTED", message: "Rechazada por SUNAT" }) });
    assert.equal((await issueOrReconcileReceipt(rejecting.service, tenantId, first.receipt.id)).receipt.status, "RECHAZADO");
    assert.equal((await getReceiptById(tenantId, sale.id))?.creditNote?.status, "RECHAZADO");

    const second = await prepareCreditNote(tenantId, sale.id, { reasonCode: "01", description: "DEVOLUCION" });
    assert.notEqual(second.receipt.id, first.receipt.id, "A rejected credit note must not block a new attempt");
    assert.equal((await issueOrReconcileReceipt(fakeBilling({}).service, tenantId, second.receipt.id)).receipt.status, "ACEPTADO");
    const voided = await getReceiptById(tenantId, sale.id);
    assert.equal(voided?.creditNote?.id, second.receipt.id);
    assert.equal(voided?.creditNote?.status, "ACEPTADO");

    const again = await prepareCreditNote(tenantId, sale.id, { reasonCode: "01", description: "DEVOLUCION" });
    assert.equal(again.receipt.id, second.receipt.id, "An accepted credit note is returned, never duplicated");
    assert.equal(again.created, false);
  }],

  ["notas parciales: devolución por ítem respeta cantidades y saldo; luego no se permite anulación total", async () => {
    const tenantId = await createTenant();
    const sale = await newReceipt(tenantId); // 3 líneas de S/ 1.00
    await issueOrReconcileReceipt(fakeBilling({}).service, tenantId, sale.id);

    const partial = await prepareCreditNote(tenantId, sale.id, { reasonCode: "07", items: [{ lineIndex: 0, quantity: 1 }], clientTransactionId: `nc-07-${randomUUID()}` });
    assert.equal(partial.receipt.total, 1);
    assert.equal(partial.receipt.noteReasonCode, "07");
    await assert.rejects(
      prepareCreditNote(tenantId, sale.id, { reasonCode: "07", items: [{ lineIndex: 0, quantity: 1 }], clientTransactionId: `nc-07-${randomUUID()}` }),
      (error: unknown) => error instanceof NoteError && error.code === "EXCEEDS_QUANTITY"
    );
    const discount = await prepareCreditNote(tenantId, sale.id, { reasonCode: "09", amount: 1.5, clientTransactionId: `nc-09-${randomUUID()}` });
    assert.equal(discount.receipt.total, 1.5);
    await assert.rejects(
      prepareCreditNote(tenantId, sale.id, { reasonCode: "09", amount: 1, clientTransactionId: `nc-09-${randomUUID()}` }),
      (error: unknown) => error instanceof NoteError && error.code === "EXCEEDS_BALANCE"
    );
    await assert.rejects(
      prepareCreditNote(tenantId, sale.id, { reasonCode: "01" }),
      (error: unknown) => error instanceof NoteError && error.code === "HAS_PARTIAL_CREDITS"
    );
    const updated = await getReceiptById(tenantId, sale.id);
    assert.equal(updated?.creditedTotal, 2.5);
  }],

  ["notas simultáneas: dos devoluciones del mismo ítem no superan lo vendido", async () => {
    const tenantId = await createTenant();
    const sale = await newReceipt(tenantId);
    await issueOrReconcileReceipt(fakeBilling({}).service, tenantId, sale.id);
    const attempts = await Promise.allSettled([1, 2, 3].map(() =>
      prepareCreditNote(tenantId, sale.id, { reasonCode: "07", items: [{ lineIndex: 1, quantity: 1 }], clientTransactionId: `nc-c-${randomUUID()}` })
    ));
    assert.equal(attempts.filter((a) => a.status === "fulfilled").length, 1, "Only one return of the single unit may succeed");
  }],

  ["nota de débito suma al saldo acreditable", async () => {
    const tenantId = await createTenant();
    const sale = await newReceipt(tenantId);
    await issueOrReconcileReceipt(fakeBilling({}).service, tenantId, sale.id);
    const debit = await prepareDebitNote(tenantId, sale.id, { reasonCode: "01", description: "Intereses por mora", items: [{ name: "INTERESES", quantity: 1, unitPrice: 2 }] });
    assert.equal(debit.receipt.documentType, "NOTA_DEBITO");
    assert.equal(debit.receipt.total, 2);
    const discount = await prepareCreditNote(tenantId, sale.id, { reasonCode: "09", amount: 5, clientTransactionId: `nc-d-${randomUUID()}` });
    assert.equal(discount.receipt.total, 5, "3.00 sale + 2.00 debit = 5.00 creditable");
  }],

  ["baja: idempotente, consulta el ticket y bloquea notas posteriores", async () => {
    const tenantId = await createTenant();
    const sale = await newReceipt(tenantId);
    await issueOrReconcileReceipt(fakeBilling({}).service, tenantId, sale.id);
    const { service, calls } = fakeBilling({});
    const first = await prepareVoiding(tenantId, sale.id, "No se entregó");
    const again = await prepareVoiding(tenantId, sale.id, "No se entregó");
    assert.equal(first.voiding.id, again.voiding.id);
    assert.equal(first.voiding.kind, "RESUMEN_BAJA", "A boleta is voided through a daily summary");
    const sent = await processVoiding(service, tenantId, first.voiding.id);
    assert.equal(sent.status, "PENDIENTE");
    assert.equal(sent.ticket, "TICKET-1");
    const checked = await processVoiding(service, tenantId, first.voiding.id);
    assert.equal(checked.status, "ACEPTADO");
    assert.equal(calls.voidingRequests, 1, "With a ticket the baja is only queried, never re-sent");
    assert.equal(calls.voidingChecks, 1);
    await assert.rejects(prepareCreditNote(tenantId, sale.id, { reasonCode: "09", amount: 1 }), (error: unknown) => error instanceof NoteError && error.code === "VOIDED");
  }],

  ["baja: rechazada si hay notas o fuera de plazo", async () => {
    const tenantId = await createTenant();
    const sale = await newReceipt(tenantId);
    await issueOrReconcileReceipt(fakeBilling({}).service, tenantId, sale.id);
    await prepareCreditNote(tenantId, sale.id, { reasonCode: "09", amount: 1, clientTransactionId: `nc-b-${randomUUID()}` });
    await assert.rejects(prepareVoiding(tenantId, sale.id, "x baja"), (error: unknown) => error instanceof VoidingError && /notas/.test(error.message));

    const old = await newReceipt(tenantId);
    await issueOrReconcileReceipt(fakeBilling({}).service, tenantId, old.id);
    await sql`update receipts set issue_date = now() - interval '9 days' where id = ${old.id}`;
    await assert.rejects(prepareVoiding(tenantId, old.id, "x baja"), (error: unknown) => error instanceof VoidingError && /plazo/.test(error.message));
  }],

  ["guía de remisión: pendiente con ticket, luego aceptada; idempotente por transacción", async () => {
    const tenantId = await createTenant();
    const { service, calls } = fakeBilling({});
    const input = {
      clientTransactionId: `gre-${randomUUID()}`,
      guideType: "REMITENTE" as const,
      data: {
        recipient: { documentType: "6" as const, documentNumber: "20000000002", name: "CLIENTE SA" },
        reasonCode: "01", transportMode: "02" as const,
        transferDate: new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 10),
        grossWeight: 5, weightUnit: "KGM" as const, packages: 1,
        origin: { ubigeo: "150101", address: "AV ORIGEN 1" }, destination: { ubigeo: "150122", address: "AV LLEGADA 2" },
        vehiclePlate: "ABC123", driver: { documentType: "1" as const, documentNumber: "12345678", names: "ANA", surnames: "PEREZ", license: "Q12345678" },
        items: [{ description: "CAJA DE GASEOSAS", quantity: 2, unit: "NIU" }]
      }
    };
    const created = await prepareGuide(tenantId, input);
    assert.equal(created.guide.series, "TZ01", "Practice tenants use isolated guide series");
    assert.equal((await prepareGuide(tenantId, input)).guide.id, created.guide.id);
    assert.equal((await processGuide(service, tenantId, created.guide.id)).status, "PENDIENTE");
    assert.equal((await processGuide(service, tenantId, created.guide.id)).status, "ACEPTADO");
    assert.equal(calls.despatchSends, 1, "With a ticket the guide is only queried, never re-sent");
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
