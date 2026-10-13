import assert from "node:assert/strict";
import { attentionCount, awaitingSendCount, effectiveSales, todaySales } from "../src/domain/receiptMetrics";
import { quoteTotals } from "../src/domain/pricing";
import { priceItems } from "../../api/src/modules/receipts/pricing";
import { localStatusInfo, remoteStatusInfo } from "../src/domain/receiptStatus";

type R = Parameters<typeof effectiveSales>[0][number];
const now = new Date(2026, 9, 12, 15, 0, 0);
const base = { issueDate: now.toISOString(), total: 10, status: "ACCEPTED", documentType: "BOLETA" } as const;
const receipts: R[] = [
  { ...base, clientTransactionId: "a", total: 10.1 },
  { ...base, clientTransactionId: "b", total: 20.2, documentType: "FACTURA" },
  { ...base, clientTransactionId: "c", voided: true },
  { ...base, clientTransactionId: "d", documentType: "NOTA_CREDITO" },
  { ...base, clientTransactionId: "e", status: "PENDING" },
  { ...base, clientTransactionId: "f", issueDate: new Date(2026, 9, 11, 10).toISOString() }
];
let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed += 1; console.log(`  ✓ ${name}`); };

test("venta vigente excluye anuladas, notas y no aceptadas", () => {
  assert.deepEqual(effectiveSales(receipts).map((r) => r.clientTransactionId), ["a", "b", "f"]);
});
test("total de hoy suma en centavos y solo el día local", () => {
  assert.deepEqual(todaySales(receipts, now), { count: 2, total: 30.3 });
});
test("por revisar no cuenta dos veces el mismo comprobante local y remoto", () => {
  const queue = [{ clientTransactionId: "x", status: "REJECTED" as const }, { clientTransactionId: "y", status: "ERROR" as const }, { clientTransactionId: "z", status: "PENDING" as const }];
  const history = [{ clientTransactionId: "x", status: "REJECTED" as const }, { clientTransactionId: "w", status: "ERROR" as const }];
  assert.equal(attentionCount(queue, history), 3);
  assert.equal(attentionCount(queue), 2);
});
test("pendientes de envío no incluye errores", () => {
  assert.equal(awaitingSendCount([{ status: "PENDING" }, { status: "SYNCING" }, { status: "ERROR" }, { status: "ACCEPTED" }]), 2);
});
test("ERROR nunca se muestra como RECHAZADO", () => {
  assert.notEqual(localStatusInfo("ERROR").label, localStatusInfo("REJECTED").label);
  assert.notEqual(remoteStatusInfo("ERROR").label, remoteStatusInfo("REJECTED").label);
  assert.equal(remoteStatusInfo("ACCEPTED", "f").label, "Aceptada");
});
test("cotización del celular = pricing.ts del servidor (centavo a centavo)", () => {
  let seed = 7;
  const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  for (let i = 0; i < 500; i++) {
    const items = Array.from({ length: 1 + Math.floor(rnd() * 5) }, () => ({ quantity: Math.round((0.25 + rnd() * 9) * 100) / 100, unitPrice: Math.round(rnd() * 5000) / 100 }));
    const mine = quoteTotals(items);
    const server = priceItems(items);
    assert.deepEqual({ s: mine.subtotal, i: mine.igv, t: mine.total }, { s: server.subtotal, i: server.igv, t: server.total }, JSON.stringify(items));
  }
});
test("el IGV mostrado no usa el redondeo global antiguo", () => {
  const items = [{ quantity: 1, unitPrice: 0.05 }, { quantity: 1, unitPrice: 0.05 }, { quantity: 1, unitPrice: 0.05 }];
  assert.equal(quoteTotals(items).igv, priceItems(items).igv);
});
console.log(`MOBILE DOMAIN: ${passed} PASS`);
