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

async function rawRequest(path: string, options: RequestInit = {}, token?: string) {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (token) headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(`${apiBase}${path}`, { ...options, headers });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  return { status: response.status, body };
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
    rows: [{ ruc: E2E_RUC, legalName: E2E_RUC_NAME, fiscalAddress: "AV. E2E 123 LIMA" }]
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

  log("Activating Nubefact (sandbox) for tenant A");
  const nubefactSettings = await request<{ providerCode: string; credentialConfigured: boolean }>("/v1/billing/settings", {
    method: "PATCH",
    body: JSON.stringify({ providerCode: "nubefact", environment: "sandbox" })
  }, tokenA);
  assert.equal(nubefactSettings.providerCode, "nubefact");
  assert.equal(nubefactSettings.credentialConfigured, true);
  const connection = await request<{ ok: boolean }>("/v1/billing/test-connection", { method: "POST" }, tokenA);
  assert.equal(connection.ok, true, "Nubefact connection test must pass");

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
  const viewHtml = await viewResponse.text();
  assert.match(viewHtml, /B001-00000002/);
  assert.match(viewHtml, /comprobante oficial/, "The public view must link the official PDF");
  assert.match(viewHtml, /Código hash/);
  // Con proveedor real se comparte la representación impresa oficial (QR + hash).
  assert.match(share.pdfUrl, /^https:\/\/www\.nubefact\.com\/cpe\/.+\.pdf$/);

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

  log("Rejecting a sale whose total does not match its items");
  const tampered = await rawRequest("/v1/receipts", {
    method: "POST",
    body: JSON.stringify({
      clientTransactionId: `e2e-tampered-${suffix}`,
      temporaryNumber: "VT-E2E-TAMPERED",
      documentType: "BOLETA",
      total: 1,
      items: [{ id: "x", name: "LAPTOP", quantity: 1, unitPrice: 100 }]
    })
  }, tokenA);
  assert.equal(tampered.status, 422);
  assert.equal(tampered.body.code, "TOTAL_MISMATCH");
  assert.equal(tampered.body.retryable, false);

  log("Rejecting a factura without RUC before reserving a correlative");
  const facturaSinRuc = await rawRequest("/v1/receipts", {
    method: "POST",
    body: JSON.stringify({
      clientTransactionId: `e2e-factura-sin-ruc-${suffix}`,
      temporaryNumber: "VT-E2E-F0",
      documentType: "FACTURA",
      total: 11.8,
      items: [{ id: "e2e-product-1", name: "GASEOSA E2E", quantity: 1, unitPrice: 11.8 }]
    })
  }, tokenA);
  assert.equal(facturaSinRuc.status, 422);
  assert.equal(facturaSinRuc.body.code, "FACTURA_REQUIRES_RUC");
  const factura = await request<{ officialNumber: string; status: string }>("/v1/receipts", {
    method: "POST",
    body: JSON.stringify({
      clientTransactionId: `e2e-factura-ok-${suffix}`,
      temporaryNumber: "VT-E2E-F1",
      documentType: "FACTURA",
      total: 11.8,
      customer: { documentType: "RUC", documentNumber: E2E_RUC, name: E2E_RUC_NAME },
      items: [{ id: "e2e-product-1", name: "GASEOSA E2E", quantity: 1, unitPrice: 11.8 }]
    })
  }, tokenA);
  assert.equal(factura.status, "ACCEPTED");
  assert.equal(factura.officialNumber, "F001-00000001", "The rejected factura must not consume a correlative");
  const facturaDetail = await request<{ customer?: { address?: string } }>(
    `/v1/receipts/by-transaction/${encodeURIComponent(`e2e-factura-ok-${suffix}`)}`, {}, tokenA
  );
  assert.equal(facturaDetail.customer?.address, "AV. E2E 123 LIMA", "Factura address must be filled from the SUNAT registry");

  log("Rejecting a boleta over S/ 700 without customer");
  const boletaGrande = await rawRequest("/v1/receipts", {
    method: "POST",
    body: JSON.stringify({
      clientTransactionId: `e2e-boleta-grande-${suffix}`,
      temporaryNumber: "VT-E2E-B700",
      documentType: "BOLETA",
      total: 800,
      items: [{ id: "x", name: "TV", quantity: 1, unitPrice: 800 }]
    })
  }, tokenA);
  assert.equal(boletaGrande.status, 422);
  assert.equal(boletaGrande.body.code, "BOLETA_REQUIRES_CUSTOMER");

  log("Blocking billing credential and production tampering");
  const secretRef = await rawRequest("/v1/billing/settings", {
    method: "PATCH",
    body: JSON.stringify({ providerCode: "apisperu", environment: "sandbox", credentialSecretRef: "env:JWT_SECRET" })
  }, tokenA);
  assert.equal(secretRef.status, 400, "Tenants must not choose which server secret is used");
  const production = await rawRequest("/v1/billing/settings", {
    method: "PATCH",
    body: JSON.stringify({ providerCode: "apisperu", environment: "production" })
  }, tokenA);
  assert.equal(production.status, 409, "Production must stay disabled until the platform enables it");
  const settings = await request<Record<string, unknown>>("/v1/billing/settings", {}, tokenA);
  assert.equal(settings.credentialSecretRef, undefined, "The secret reference must not be exposed");
  assert.equal(settings.environment, "sandbox");

  log("Recording payment method and cash change");
  const yapeSale = await request<{ status: string; paymentMethod: string }>("/v1/receipts", {
    method: "POST",
    body: JSON.stringify({
      clientTransactionId: `e2e-yape-${suffix}`,
      temporaryNumber: "VT-E2E-YAPE",
      documentType: "BOLETA",
      total: 23.6,
      paymentMethod: "YAPE",
      items: [{ id: "e2e-product-1", name: "GASEOSA E2E", quantity: 2, unitPrice: 11.8 }]
    })
  }, tokenA);
  assert.equal(yapeSale.status, "ACCEPTED");
  assert.equal(yapeSale.paymentMethod, "YAPE");
  const cashSale = await request<{ id: string; status: string; officialNumber: string; changeAmount: number }>("/v1/receipts", {
    method: "POST",
    body: JSON.stringify({
      clientTransactionId: `e2e-cash-${suffix}`,
      temporaryNumber: "VT-E2E-CASH",
      documentType: "BOLETA",
      total: 11.8,
      paymentMethod: "EFECTIVO",
      amountReceived: 20,
      items: [{ id: "e2e-product-1", name: "GASEOSA E2E", quantity: 1, unitPrice: 11.8 }]
    })
  }, tokenA);
  assert.equal(cashSale.changeAmount, 8.2);
  const shortCash = await rawRequest("/v1/receipts", {
    method: "POST",
    body: JSON.stringify({
      clientTransactionId: `e2e-short-cash-${suffix}`,
      temporaryNumber: "VT-E2E-SHORT",
      documentType: "BOLETA",
      total: 11.8,
      amountReceived: 10,
      items: [{ id: "e2e-product-1", name: "GASEOSA E2E", quantity: 1, unitPrice: 11.8 }]
    })
  }, tokenA);
  assert.equal(shortCash.body.code, "INSUFFICIENT_CASH");

  log("Voiding a sale with a credit note (idempotent)");
  const creditNote = await request<{ status: string; documentType: string; officialNumber: string; relatedReceiptId: string }>(
    `/v1/receipts/${cashSale.id}/void`, { method: "POST", body: JSON.stringify({ reason: "Cliente devolvió el producto" }) }, tokenA
  );
  assert.equal(creditNote.status, "ACCEPTED");
  assert.equal(creditNote.documentType, "NOTA_CREDITO");
  assert.equal(creditNote.officialNumber, "BC01-00000001");
  assert.equal(creditNote.relatedReceiptId, cashSale.id);
  const creditNoteRetry = await request<{ officialNumber: string }>(
    `/v1/receipts/${cashSale.id}/void`, { method: "POST", body: JSON.stringify({ reason: "Cliente devolvió el producto" }) }, tokenA
  );
  assert.equal(creditNoteRetry.officialNumber, "BC01-00000001", "Voiding twice must not create a second credit note");
  const voided = await request<{ voided: boolean; creditNote?: { officialNumber?: string } }>(`/v1/receipts/${cashSale.id}`, {}, tokenA);
  assert.equal(voided.voided, true);
  const voidByOtherTenant = await rawRequest(`/v1/receipts/${cashSale.id}/void`, { method: "POST", body: JSON.stringify({ reason: "intento ajeno" }) }, tokenB);
  assert.equal(voidByOtherTenant.status, 404, "A tenant must not void another tenant's receipt");

  log("Daily cash close and sales register for the accountant");
  const close = await request<{
    sales: { count: number; total: number };
    creditNotes: { total: number };
    netTotal: number;
    expectedCash: number;
    paymentMethods: Array<{ method: string; sales: number; refunds: number; net: number }>;
  }>("/v1/reports/daily-close", {}, tokenA);
  const yape = close.paymentMethods.find((row) => row.method === "YAPE");
  assert.equal(yape?.sales, 23.6);
  assert.equal(close.creditNotes.total, 11.8);
  assert.equal(Math.round((close.sales.total - close.creditNotes.total) * 100), Math.round(close.netTotal * 100));
  const efectivo = close.paymentMethods.find((row) => row.method === "EFECTIVO");
  assert.equal(efectivo?.refunds, 11.8);
  assert.equal(close.expectedCash, efectivo?.net);

  const month = new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 7);
  const link = await request<{ url: string }>("/v1/reports/sales-register/link", { method: "POST", body: JSON.stringify({ month }) }, tokenA);
  const csvResponse = await fetch(link.url.replace(/^https?:\/\/[^/]+/, apiBase));
  assert.equal(csvResponse.status, 200);
  const csv = await csvResponse.text();
  assert.match(csv, /BC01,1,/);
  assert.match(csv, /-11\.80/);
  assert.ok(!csv.includes("BODEGA-B"), "Export must only include the tenant's own receipts");
  const tamperedLink = await fetch(`${apiBase}/exports/sales-register.csv?t=${encodeURIComponent(link.url.split("t=")[1].slice(0, -2) + "xx")}`);
  assert.equal(tamperedLink.status, 400);

  log("Rate limiting repeated failed logins");
  let limited = false;
  for (let attempt = 0; attempt < 15 && !limited; attempt += 1) {
    const response = await fetch(`${apiBase}/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `owner-a-${suffix}@example.test`, password: "wrong-password" })
    });
    limited = response.status === 429;
  }
  assert.ok(limited, "Login must be rate limited after repeated failures");

  log("Checking Nubefact received every real document exactly once");
  const nubefactStats = await (await fetch(`${mockDocumentsBase}/stats`)).json() as { nubefactIssued: number };
  // B001 x5 (online, offline, yape, cash, + factura F001) + nota de crédito BC01 = 6 emisiones
  assert.equal(nubefactStats.nubefactIssued, 6, "Each real document must reach Nubefact exactly once");

  log("Practice mode: tenant without electronic billing uses isolated series");
  const practice = await request<{ status: string; officialNumber: string; providerCode: string }>("/v1/receipts", {
    method: "POST",
    body: JSON.stringify({
      clientTransactionId: `e2e-practice-${suffix}`,
      temporaryNumber: "VT-E2E-PRACTICE",
      documentType: "BOLETA",
      total: 5,
      items: [{ id: "x", name: "PRACTICA", quantity: 1, unitPrice: 5 }]
    })
  }, tokenB);
  assert.equal(practice.status, "ACCEPTED");
  assert.equal(practice.providerCode, "mock");
  assert.equal(practice.officialNumber, "TB01-00000001", "Practice sales must not consume real correlatives");
  const practiceLink = await request<{ url: string }>("/v1/reports/sales-register/link", { method: "POST", body: JSON.stringify({ month }) }, tokenB);
  const practiceCsv = await (await fetch(practiceLink.url.replace(/^https?:\/\/[^/]+/, apiBase))).text();
  assert.ok(!practiceCsv.includes("TB01"), "Practice sales must not reach the accountant's register");
  const practiceShare = await request<{ pdfUrl: string; viewUrl: string }>(
    `/v1/receipts/by-transaction/${encodeURIComponent(`e2e-practice-${suffix}`)}/share`, { method: "POST" }, tokenB
  );
  const practicePdf = await fetch(practiceShare.pdfUrl);
  assert.equal(practicePdf.status, 200);
  assert.match(practicePdf.headers.get("content-type") ?? "", /application\/pdf/);
  const pdfBytes = new Uint8Array(await practicePdf.arrayBuffer());
  assert.equal(Buffer.from(pdfBytes.slice(0, 4)).toString("ascii"), "%PDF");
  assert.match(Buffer.from(pdfBytes).toString("latin1"), /ENTORNO DE PRUEBA/, "Practice PDF must say it has no tax validity");
  assert.match(await (await fetch(practiceShare.viewUrl)).text(), /SIN VALIDEZ TRIBUTARIA/);

  log("PASS: register -> tenant -> RUC -> DNI cache -> sale -> idempotency -> offline resync -> PDF -> delivery -> validations -> billing security -> payments -> credit note -> daily close -> CSV -> Nubefact -> practice mode -> rate limit");
}

main()
  .catch((error) => {
    console.error("[E2E] FAIL", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase().catch(() => undefined);
  });
