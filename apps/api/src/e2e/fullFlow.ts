import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { closeDatabase } from "../db/client.js";
import { runMigrations } from "../db/migrations.js";
import {
  completeSunatRucImport,
  startSunatRucImport,
  upsertSunatRucRows
} from "../modules/sunatRuc/sunatRucRegistryRepository.js";

const apiBase = process.env.E2E_API_BASE_URL ?? "http://localhost:4000";
const mockDocumentsBase = process.env.E2E_MOCK_DOCUMENT_BASE_URL ?? "http://localhost:4100";
const E2E_RUC = "20142485878";
const E2E_RUC_NAME = "INSTITUTO DE DESARROLLO URBANO CENCA";

function log(step: string) {
  console.log(`[E2E] ${step}`);
}

async function request<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (token) headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(`${apiBase}${path}`, { ...options, headers });
  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();
  if (!response.ok) {
    throw new Error(`${options.method ?? "GET"} ${path} -> ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload as T;
}

async function seedRucFixture() {
  if (process.env.ALLOW_E2E_SEED !== "true") throw new Error("ALLOW_E2E_SEED=true is required");
  await runMigrations();
  const runId = await startSunatRucImport({
    sourceUrl: "e2e://fixture/sunat-ruc",
    sourceUpdatedAt: "2026-08-28"
  });
  await upsertSunatRucRows({
    runId,
    sourceUpdatedAt: "2026-08-28",
    rows: [{ ruc: E2E_RUC, legalName: E2E_RUC_NAME }]
  });
  await completeSunatRucImport({ runId, rowCount: 1, pruneMissing: false });
}

async function register(email: string) {
  return request<{ accessToken: string; user: { id: string; email: string; tenantId: string } }>(
    "/v1/auth/register",
    { method: "POST", body: JSON.stringify({ email, password: "E2ePassword123!" }) }
  );
}

async function main() {
  log("Preparing database and RUC fixture");
  await seedRucFixture();
  await fetch(`${mockDocumentsBase}/reset`, { method: "POST" });

  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const businessRuc = `20${String(Date.now()).slice(-9)}`;
  const ownerA = await register(`owner-a-${suffix}@example.test`);
  const ownerB = await register(`owner-b-${suffix}@example.test`);
  const tokenA = ownerA.accessToken;
  const tokenB = ownerB.accessToken;

  log("Configuring tenant A");
  const business = await request<{ id: string; businessName?: string }>(
    "/v1/business",
    {
      method: "PATCH",
      body: JSON.stringify({
        ruc: businessRuc,
        businessName: "BODEGA E2E",
        tradeName: "BODEGA E2E",
        onboardingComplete: true
      })
    },
    tokenA
  );
  assert.equal(business.businessName, "BODEGA E2E");

  log("Validating RUC lookup from local SUNAT registry");
  const taxpayer = await request<{ ruc: string; businessName: string; source: string }>(`/v1/taxpayers/${E2E_RUC}`, {}, tokenA);
  assert.equal(taxpayer.ruc, E2E_RUC);
  assert.equal(taxpayer.businessName, E2E_RUC_NAME);
  assert.equal(taxpayer.source, "SUNAT_RUC_PADRON");

  const rucCustomer = await request<{ customerId: string; nombreCompleto: string; source: string }>(
    "/v1/customers/lookup",
    { method: "POST", body: JSON.stringify({ tipoDoc: "RUC", numero: E2E_RUC }) },
    tokenA
  );
  assert.equal(rucCustomer.nombreCompleto, E2E_RUC_NAME);
  assert.equal(rucCustomer.source, "SUNAT_RUC_PADRON");

  log("Validating multi-tenant customer isolation");
  const foreignCustomerResponse = await fetch(`${apiBase}/v1/customers/${rucCustomer.customerId}`, {
    headers: { authorization: `Bearer ${tokenB}` }
  });
  assert.equal(foreignCustomerResponse.status, 404);

  log("Validating DNI external lookup then server cache");
  const firstDni = await request<{ nombreCompleto: string; source: string; customerId: string }>(
    "/v1/customers/lookup",
    { method: "POST", body: JSON.stringify({ tipoDoc: "DNI", numero: "12345678" }) },
    tokenA
  );
  assert.equal(firstDni.nombreCompleto, "ANA MARIA PRUEBA E2E");
  assert.equal(firstDni.source, "EXTERNAL");

  const secondDni = await request<{ nombreCompleto: string; source: string; customerId: string }>(
    "/v1/customers/lookup",
    { method: "POST", body: JSON.stringify({ tipoDoc: "DNI", numero: "12345678" }) },
    tokenA
  );
  assert.equal(secondDni.source, "CACHE_SERVER");
  assert.equal(secondDni.customerId, firstDni.customerId);

  const providerStats = await (await fetch(`${mockDocumentsBase}/stats`)).json() as { dni: number; ruc: number };
  assert.equal(providerStats.dni, 1, "The second DNI lookup must not call the external provider");
  assert.equal(providerStats.ruc, 0, "RUC fixture must be resolved locally without external provider");

  const lookupSummary = await request<{ totalLookups: number; externalLookups: number; cacheHits: number; estimatedCost: number }>(
    "/v1/customer-lookups/summary",
    {},
    tokenA
  );
  assert.equal(lookupSummary.externalLookups, 1);
  assert.equal(lookupSummary.estimatedCost, 0.03);

  log("Creating product");
  await request(
    "/v1/products/e2e-product-1",
    { method: "PUT", body: JSON.stringify({ name: "GASEOSA E2E", unitPrice: 11.8, favorite: true }) },
    tokenA
  );

  const onlineTx = `e2e-online-${suffix}`;
  const onlineSale = {
    clientTransactionId: onlineTx,
    temporaryNumber: "VT-E2E-ONLINE",
    documentType: "BOLETA",
    total: 11.8,
    customer: {
      documentType: "DNI",
      documentNumber: "12345678",
      name: "ANA MARIA PRUEBA E2E"
    },
    items: [{ id: "e2e-product-1", name: "GASEOSA E2E", quantity: 1, unitPrice: 11.8, unit: "NIU" }]
  };

  log("Issuing first online receipt");
  const receipt1 = await request<{ officialNumber: string; status: string; sunatStatus: string; clientTransactionId: string }>(
    "/v1/receipts",
    { method: "POST", body: JSON.stringify(onlineSale) },
    tokenA
  );
  assert.equal(receipt1.status, "ACCEPTED");
  assert.equal(receipt1.sunatStatus, "ACEPTADO");
  assert.equal(receipt1.officialNumber, "B001-00000001");

  log("Checking idempotency by retrying the same transaction");
  const receipt1Retry = await request<{ officialNumber: string; status: string }>(
    "/v1/receipts",
    { method: "POST", body: JSON.stringify(onlineSale) },
    tokenA
  );
  assert.equal(receipt1Retry.officialNumber, "B001-00000001");

  log("Simulating offline sale resynchronization");
  const offlineTx = `e2e-offline-${suffix}`;
  const receipt2 = await request<{ officialNumber: string; status: string; sunatStatus: string }>(
    "/v1/receipts",
    {
      method: "POST",
      body: JSON.stringify({
        ...onlineSale,
        clientTransactionId: offlineTx,
        temporaryNumber: "VT-E2E-OFFLINE"
      })
    },
    tokenA
  );
  assert.equal(receipt2.status, "ACCEPTED");
  assert.equal(receipt2.sunatStatus, "ACEPTADO");
  assert.equal(receipt2.officialNumber, "B001-00000002");

  const history = await request<Array<{ officialNumber?: string }>>("/v1/receipts", {}, tokenA);
  assert.equal(history.length, 2);

  log("Logging in again and recovering persisted history");
  const relogin = await request<{ accessToken: string }>(
    "/v1/auth/login",
    { method: "POST", body: JSON.stringify({ email: `owner-a-${suffix}@example.test`, password: "E2ePassword123!" }) }
  );
  const recoveredHistory = await request<Array<{ officialNumber?: string }>>("/v1/receipts", {}, relogin.accessToken);
  assert.equal(recoveredHistory.length, 2);
  assert.ok(recoveredHistory.some((item) => item.officialNumber === "B001-00000002"));

  log("Generating secure view and PDF links");
  const share = await request<{ viewUrl: string; pdfUrl: string; documentNumber: string }>(
    `/v1/receipts/by-transaction/${encodeURIComponent(offlineTx)}/share`,
    { method: "POST" },
    tokenA
  );
  assert.equal(share.documentNumber, "B001-00000002");
  const viewResponse = await fetch(share.viewUrl);
  assert.equal(viewResponse.status, 200);
  assert.match(await viewResponse.text(), /B001-00000002/);
  const pdfResponse = await fetch(share.pdfUrl);
  assert.equal(pdfResponse.status, 200);
  assert.match(pdfResponse.headers.get("content-type") ?? "", /application\/pdf/);
  const pdfBytes = new Uint8Array(await pdfResponse.arrayBuffer());
  assert.equal(Buffer.from(pdfBytes.slice(0, 4)).toString("ascii"), "%PDF");

  log("Testing queued automatic delivery in mock mode");
  const delivery = await request<{ status: string }>(
    `/v1/receipts/by-transaction/${encodeURIComponent(offlineTx)}/deliveries`,
    { method: "POST", body: JSON.stringify({ channel: "WHATSAPP", destination: "+51999999999" }) },
    tokenA
  );
  assert.equal(delivery.status, "PENDING");
  const processed = await request<Array<{ status: string }>>(
    "/v1/deliveries/process-pending",
    { method: "POST" },
    tokenA
  );
  assert.ok(processed.some((item) => item.status === "SENT"));

  log("PASS: register -> tenant -> RUC -> DNI cache -> sale -> idempotency -> offline resync -> PDF -> delivery");
}

main()
  .catch((error) => {
    console.error("[E2E] FAIL", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase().catch(() => undefined);
  });
