import assert from "node:assert/strict";
import { enqueueReceipt, getQueue, patchReceipt } from "../src/storage/receiptQueue";
import { loadPendingDeletes, savePendingDeletes } from "../src/storage/catalog";
import type { PendingReceipt } from "../src/domain/types";

const make = (id: string): PendingReceipt => ({ clientTransactionId: id, temporaryNumber: id, createdAt: "2026-10-12T10:00:00Z", documentType: "BOLETA", items: [], total: 1, status: "PENDING" });
let passed = 0;
const test = async (name: string, fn: () => Promise<void>) => { await fn(); passed += 1; console.log(`  ✓ ${name}`); };

async function main() {
await test("ventas y parches simultáneos no pierden registros (carrera de la cola)", async () => {
  const scope = "t1";
  await Promise.all([
    ...Array.from({ length: 25 }, (_, i) => enqueueReceipt(scope, make(`c${i}`))),
    ...Array.from({ length: 25 }, (_, i) => patchReceipt(scope, `c${i}`, { status: "SYNCING" }))
  ]);
  const queue = await getQueue(scope);
  assert.equal(queue.length, 25);
  assert.equal(new Set(queue.map((r) => r.clientTransactionId)).size, 25);
});
await test("las colas de dos negocios no se mezclan", async () => {
  await enqueueReceipt("negocioA", make("a1"));
  await enqueueReceipt("negocioB", make("b1"));
  assert.deepEqual((await getQueue("negocioA")).map((r) => r.clientTransactionId), ["a1"]);
  assert.deepEqual((await getQueue("negocioB")).map((r) => r.clientTransactionId), ["b1"]);
});
await test("borrados pendientes se guardan sin duplicados y se limpian", async () => {
  await savePendingDeletes("t2", ["p1", "p2", "p1"]);
  assert.deepEqual((await loadPendingDeletes("t2")).sort(), ["p1", "p2"]);
  await savePendingDeletes("t2", []);
  assert.deepEqual(await loadPendingDeletes("t2"), []);
});
console.log(`MOBILE QUEUE: ${passed} PASS`);
}
main().catch((error) => { console.error(error); process.exit(1); });
