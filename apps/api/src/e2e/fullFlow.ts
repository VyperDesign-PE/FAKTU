import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { closeDatabase, sql } from "../db/client.js";
import { totpCode } from "../modules/security/totp.js";
import { decryptSecret, encryptSecret, getCachedTenantSecret, loadSecretCache, setTenantSecret } from "../modules/security/vault.js";
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
  // Proveedores que solo tienen sonda de salud no pueden elegirse como emisor.
  const efactAttempt = await fetch(`${apiBase}/v1/billing/settings`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({ providerCode: "efact", environment: "sandbox" })
  });
  assert.equal(efactAttempt.status, 409, "Efact todavía no puede emitir");
  const providerList = await request<{ providers: Array<{ code: string; canIssue: boolean }> }>("/v1/billing/providers", {}, tokenA);
  assert.equal(providerList.providers.find((item) => item.code === "efact")?.canIssue, false);
  assert.equal(providerList.providers.find((item) => item.code === "nubefact")?.canIssue, true);

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

  log("Checking Nubefact received every real document exactly once");
  const nubefactStats = await (await fetch(`${mockDocumentsBase}/stats`)).json() as { nubefactIssued: number };
  // B001 x5 (online, offline, yape, cash, + factura F001) + nota de crédito BC01 = 6 emisiones
  assert.equal(nubefactStats.nubefactIssued, 6, "Each real document must reach Nubefact exactly once");

  type ApiReceipt = { id: string; status: string; officialNumber: string; total: number; voided?: boolean; voidingBlockers?: string[]; documentType: string };
  const today = new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 10);
  const byTx = (tx: string, token: string) => request<ApiReceipt>(`/v1/receipts/by-transaction/${encodeURIComponent(tx)}`, {}, token);

  log("Nubefact: partial return (07), debit note, comunicación de baja and guía de remisión");
  const yapeReceipt = await byTx(`e2e-yape-${suffix}`, tokenA);
  const partialBody = { reasonCode: "07", description: "Devolvió una gaseosa", items: [{ lineIndex: 0, quantity: 1 }], clientTransactionId: `e2e-nc07-${suffix}` };
  const partialReturn = await request<ApiReceipt>(`/v1/receipts/${yapeReceipt.id}/credit-notes`, { method: "POST", body: JSON.stringify(partialBody) }, tokenA);
  assert.equal(partialReturn.status, "ACCEPTED");
  assert.equal(partialReturn.officialNumber, "BC01-00000002");
  assert.equal(partialReturn.total, 11.8);
  const partialRepeat = await request<ApiReceipt>(`/v1/receipts/${yapeReceipt.id}/credit-notes`, { method: "POST", body: JSON.stringify(partialBody) }, tokenA);
  assert.equal(partialRepeat.officialNumber, "BC01-00000002", "Same clientTransactionId must return the same note");
  const tooMany = await rawRequest(`/v1/receipts/${yapeReceipt.id}/credit-notes`, { method: "POST", body: JSON.stringify({ ...partialBody, items: [{ lineIndex: 0, quantity: 2 }], clientTransactionId: `e2e-nc07b-${suffix}` }) }, tokenA);
  assert.equal(tooMany.body.code, "EXCEEDS_QUANTITY");

  const facturaReceipt = await byTx(`e2e-factura-ok-${suffix}`, tokenA);
  const debit = await request<ApiReceipt>(`/v1/receipts/${facturaReceipt.id}/debit-notes`, {
    method: "POST",
    body: JSON.stringify({ reasonCode: "01", description: "Intereses por pago tardío", items: [{ name: "INTERESES POR MORA", quantity: 1, unitPrice: 5.9 }] })
  }, tokenA);
  assert.equal(debit.status, "ACCEPTED");
  assert.equal(debit.documentType, "NOTA_DEBITO");
  assert.equal(debit.officialNumber, "FD01-00000001");

  const firstSale = await byTx(onlineTx, tokenA);
  assert.deepEqual(firstSale.voidingBlockers, [], "A clean receipt issued today can be voided");
  const baja = await rawRequest(`/v1/receipts/${firstSale.id}/baja`, { method: "POST", body: JSON.stringify({ reason: "No se entregó al cliente" }) }, tokenA);
  assert.equal(baja.status, 202, "SUNAT answers a baja asynchronously");
  const bajaVoiding = baja.body.voiding as { id: string; status: string; ticket: string };
  assert.equal(bajaVoiding.status, "PENDING");
  assert.ok(bajaVoiding.ticket);
  const bajaRefreshed = await request<{ voiding: { status: string }; receipt: ApiReceipt }>(`/v1/voidings/${bajaVoiding.id}/refresh`, { method: "POST" }, tokenA);
  assert.equal(bajaRefreshed.voiding.status, "ACCEPTED");
  assert.equal(bajaRefreshed.receipt.voided, true);
  const bajaAgain = await request<{ voiding: { id: string } }>(`/v1/receipts/${firstSale.id}/baja`, { method: "POST", body: JSON.stringify({ reason: "No se entregó al cliente" }) }, tokenA);
  assert.equal(bajaAgain.voiding.id, bajaVoiding.id, "A baja is idempotent");
  const noteAfterBaja = await rawRequest(`/v1/receipts/${firstSale.id}/credit-notes`, { method: "POST", body: JSON.stringify({ reasonCode: "09", amount: 1 }) }, tokenA);
  assert.equal(noteAfterBaja.body.code, "VOIDED");

  const guideBody = {
    clientTransactionId: `e2e-gre-${suffix}`,
    guideType: "REMITENTE",
    relatedReceiptId: facturaReceipt.id,
    data: {
      recipient: { documentType: "6", documentNumber: E2E_RUC, name: E2E_RUC_NAME, address: "AV. E2E 123 LIMA" },
      reasonCode: "01",
      transportMode: "02",
      transferDate: today,
      grossWeight: 18.5,
      weightUnit: "KGM",
      packages: 2,
      origin: { ubigeo: "150101", address: "AV. ALMACEN 100" },
      destination: { ubigeo: "150122", address: "AV. CLIENTE 200" },
      vehiclePlate: "ABC-444",
      driver: { documentType: "1", documentNumber: "45678912", names: "JORGE", surnames: "LOPEZ", license: "Q45678912" },
      items: [{ code: "e2e-product-1", description: "GASEOSA E2E x 24", quantity: 2, unit: "NIU" }]
    }
  };
  const guide = await rawRequest("/v1/despatch-guides", { method: "POST", body: JSON.stringify(guideBody) }, tokenA);
  assert.equal(guide.status, 202, "SUNAT accepts guides asynchronously");
  assert.equal(guide.body.number, "T001-00000001");
  const guideAccepted = await request<{ status: string; id: string }>(`/v1/despatch-guides/${guide.body.id}/refresh`, { method: "POST" }, tokenA);
  assert.equal(guideAccepted.status, "ACCEPTED");
  const guideShare = await request<{ pdfUrl: string }>(`/v1/despatch-guides/${guide.body.id}/share`, { method: "POST" }, tokenA);
  assert.match(guideShare.pdfUrl, /^https:\/\/www\.nubefact\.com\/guia\//);
  const invalidGuide = await rawRequest("/v1/despatch-guides", { method: "POST", body: JSON.stringify({ ...guideBody, clientTransactionId: `e2e-gre-bad-${suffix}`, data: { ...guideBody.data, vehiclePlate: undefined } }) }, tokenA);
  assert.equal(invalidGuide.body.code, "VEHICLE_REQUIRED");
  const nubefactSuite = await (await fetch(`${mockDocumentsBase}/stats`)).json() as { nubefactVoidings: number; nubefactGuides: number };
  assert.equal(nubefactSuite.nubefactVoidings, 1);
  assert.equal(nubefactSuite.nubefactGuides, 1);

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
  const practiceGuide = await request<{ status: string; number: string; id: string; practice: boolean }>("/v1/despatch-guides", {
    method: "POST",
    body: JSON.stringify({
      clientTransactionId: `e2e-gre-practice-${suffix}`,
      guideType: "REMITENTE",
      data: {
        recipient: { documentType: "1", documentNumber: "12345678", name: "CLIENTE PRACTICA" },
        reasonCode: "01", transportMode: "01", transferDate: today, grossWeight: 1, weightUnit: "KGM", packages: 1,
        origin: { ubigeo: "150101", address: "AV. A 1" }, destination: { ubigeo: "150122", address: "AV. B 2" },
        carrier: { documentNumber: "20100000001", name: "TRANSPORTES SAC" },
        items: [{ description: "PRACTICA", quantity: 1, unit: "NIU" }]
      }
    })
  }, tokenB);
  assert.equal(practiceGuide.status, "ACCEPTED");
  assert.equal(practiceGuide.number, "TZ01-00000001", "Practice guides use an isolated series");
  const practiceGuideShare = await request<{ pdfUrl: string }>(`/v1/despatch-guides/${practiceGuide.id}/share`, { method: "POST" }, tokenB);
  const practiceGuidePdf = Buffer.from(await (await fetch(practiceGuideShare.pdfUrl.replace(/^https?:\/\/[^/]+/, apiBase))).arrayBuffer()).toString("latin1");
  assert.match(practiceGuidePdf, /GUIA DE REMISION REMITENTE/);
  assert.match(practiceGuidePdf, /ENTORNO DE PRUEBA/);

  log("APIsPERU: full flow for a third business (pilot provider)");
  const ownerC = await register(`owner-c-${suffix}@example.test`);
  const tokenC = ownerC.accessToken;
  await request("/v1/business", {
    method: "PATCH",
    body: JSON.stringify({
      ruc: `20${String(Date.now() + 7).slice(-9)}`,
      businessName: "LIBRERIA APISPERU E2E",
      address: "AV. E2E 456",
      ubigeo: "150101",
      department: "LIMA",
      province: "LIMA",
      district: "LIMA",
      onboardingComplete: true
    })
  }, tokenC);
  const apisperuSettings = await request<{ providerCode: string; credentialConfigured: boolean }>("/v1/billing/settings", {
    method: "PATCH",
    body: JSON.stringify({ providerCode: "apisperu", environment: "sandbox" })
  }, tokenC);
  assert.equal(apisperuSettings.credentialConfigured, true);
  assert.equal((await request<{ ok: boolean }>("/v1/billing/test-connection", { method: "POST" }, tokenC)).ok, true);

  const apisperuSale = await request<{ id: string; status: string; officialNumber: string; providerCode: string }>("/v1/receipts", {
    method: "POST",
    body: JSON.stringify({
      clientTransactionId: `e2e-apisperu-${suffix}`,
      temporaryNumber: "VT-E2E-APISPERU",
      documentType: "BOLETA",
      total: 12,
      paymentMethod: "PLIN",
      items: [{ id: "c1", name: "CUADERNO", quantity: 2, unitPrice: 3.5 }, { id: "c2", name: "LAPICERO", quantity: 1, unitPrice: 5 }]
    })
  }, tokenC);
  assert.equal(apisperuSale.status, "ACCEPTED");
  assert.equal(apisperuSale.providerCode, "apisperu");
  assert.equal(apisperuSale.officialNumber, "B001-1");

  const apisperuShare = await request<{ pdfUrl: string }>(`/v1/receipts/${apisperuSale.id}/share`, { method: "POST" }, tokenC);
  const officialPdf = await fetch(apisperuShare.pdfUrl.replace(/^https?:\/\/[^/]+/, apiBase));
  assert.equal(officialPdf.status, 200);
  assert.match(Buffer.from(await officialPdf.arrayBuffer()).toString("latin1"), /APISPERU-PDF B001-1 QR\+HASH/, "Shared PDF must be the official APIsPERU representation");

  const apisperuNote = await request<{ status: string; officialNumber: string }>(
    `/v1/receipts/${apisperuSale.id}/void`, { method: "POST", body: JSON.stringify({ reason: "Error en el precio" }) }, tokenC
  );
  assert.equal(apisperuNote.status, "ACCEPTED");
  assert.equal(apisperuNote.officialNumber, "BC01-1");
  const apisperuStats = await (await fetch(`${mockDocumentsBase}/stats`)).json() as { apisperuIssued: number; apisperuPdfs: number };
  assert.equal(apisperuStats.apisperuIssued, 2, "Boleta and credit note must reach APIsPERU exactly once");
  assert.equal(apisperuStats.apisperuPdfs, 1);

  log("APIsPERU: debit note, boleta baja through daily summary, and guía de remisión");
  const saleC = (body: object) => request<ApiReceipt>("/v1/receipts", { method: "POST", body: JSON.stringify(body) }, tokenC);
  const saleC2 = await saleC({ clientTransactionId: `e2e-apisperu-2-${suffix}`, temporaryNumber: "VT-C2", documentType: "BOLETA", total: 10, items: [{ id: "c3", name: "MOCHILA", quantity: 1, unitPrice: 10 }] });
  const debitC = await request<ApiReceipt>(`/v1/receipts/${saleC2.id}/debit-notes`, { method: "POST", body: JSON.stringify({ reasonCode: "02", items: [{ name: "AJUSTE DE PRECIO", quantity: 1, unitPrice: 2 }] }) }, tokenC);
  assert.equal(debitC.status, "ACCEPTED");
  assert.equal(debitC.officialNumber, "BD01-1");
  const saleC3 = await saleC({ clientTransactionId: `e2e-apisperu-3-${suffix}`, temporaryNumber: "VT-C3", documentType: "BOLETA", total: 4, items: [{ id: "c4", name: "BORRADOR", quantity: 2, unitPrice: 2 }] });
  const bajaC = await rawRequest(`/v1/receipts/${saleC3.id}/baja`, { method: "POST", body: JSON.stringify({ reason: "Venta registrada por error" }) }, tokenC);
  assert.equal(bajaC.status, 202);
  const bajaCVoiding = bajaC.body.voiding as { id: string; kind: string; ticket: string };
  assert.equal(bajaCVoiding.kind, "RESUMEN_BAJA", "Boletas are voided through a daily summary");
  assert.match(bajaCVoiding.ticket, /^summary-/);
  const bajaCDone = await request<{ voiding: { status: string } }>(`/v1/voidings/${bajaCVoiding.id}/refresh`, { method: "POST" }, tokenC);
  assert.equal(bajaCDone.voiding.status, "ACCEPTED");

  const guideC = await rawRequest("/v1/despatch-guides", {
    method: "POST",
    body: JSON.stringify({
      clientTransactionId: `e2e-gre-c-${suffix}`,
      guideType: "REMITENTE",
      data: {
        recipient: { documentType: "1", documentNumber: "12345678", name: "ANA MARIA PRUEBA" },
        reasonCode: "01", transportMode: "01", transferDate: today, grossWeight: 3, weightUnit: "KGM", packages: 1,
        origin: { ubigeo: "150101", address: "AV. E2E 456" }, destination: { ubigeo: "150140", address: "JR. DESTINO 9" },
        carrier: { documentNumber: "20100000001", name: "TRANSPORTES E2E SAC" },
        items: [{ description: "CUADERNOS", quantity: 10, unit: "NIU" }]
      }
    })
  }, tokenC);
  assert.equal(guideC.status, 202);
  assert.equal(guideC.body.number, "T001-00000001");
  assert.match(String(guideC.body.ticket), /^despatch-/);
  assert.equal((await request<{ status: string }>(`/v1/despatch-guides/${guideC.body.id}/refresh`, { method: "POST" }, tokenC)).status, "ACCEPTED");
  const guideCShare = await request<{ pdfUrl: string }>(`/v1/despatch-guides/${guideC.body.id}/share`, { method: "POST" }, tokenC);
  const guideCPdf = await fetch(guideCShare.pdfUrl.replace(/^https?:\/\/[^/]+/, apiBase));
  assert.match(Buffer.from(await guideCPdf.arrayBuffer()).toString("latin1"), /APISPERU-GUIA T001-1/, "Guide PDF must be the official APIsPERU representation");

  log("Stock, fiado e insights");
  const stockToken = tokenB;
  await request(`/v1/products/arroz-1kg`, { method: "PUT", body: JSON.stringify({ name: "Arroz 1 kg", unitPrice: 4.5, favorite: true, minStock: 3 }) }, stockToken);
  assert.equal((await rawRequest("/v1/products/arroz-1kg/stock", { method: "POST", body: JSON.stringify({ mode: "ADD", quantity: 5 }) }, stockToken)).status, 422, "ADD requires initial stock");
  await request("/v1/products/arroz-1kg/stock", { method: "POST", body: JSON.stringify({ mode: "SET", quantity: 10, note: "Conteo inicial" }) }, stockToken);
  const stSale = (id: string, extra: Record<string, unknown> = {}) => rawRequest("/v1/receipts", {
    method: "POST",
    body: JSON.stringify({
      clientTransactionId: `e2e-stock-${id}-${suffix}`, temporaryNumber: `VT-${id}`, documentType: "BOLETA", total: 9,
      items: [{ id: "arroz-1kg", name: "Arroz 1 kg", quantity: 2, unitPrice: 4.5 }], ...extra
    })
  }, stockToken);
  const stCashSale = await stSale("1");
  assert.ok(stCashSale.status === 200 || stCashSale.status === 202, `cash stSale: ${stCashSale.status}`);
  let stProducts = await request<Array<{ clientProductId: string; stockQty: number | null; minStock: number }>>("/v1/products", {}, stockToken);
  assert.equal(stProducts.find((p) => p.clientProductId === "arroz-1kg")?.stockQty, 8, "Sale decrements stock");

  const stNoCustomer = await stSale("2", { paymentMethod: "CREDITO" });
  assert.equal(stNoCustomer.status, 422);
  assert.equal(stNoCustomer.body.code, "CREDIT_REQUIRES_CUSTOMER");
  const stFiado = await stSale("3", { paymentMethod: "CREDITO", customer: { documentType: "DNI", documentNumber: "12345678", name: "DOÑA ROSA", phone: "987654321" } });
  assert.ok(stFiado.status === 200 || stFiado.status === 202, `stFiado: ${stFiado.status} ${JSON.stringify(stFiado.body)}`);
  const fiadoId = String(stFiado.body.id);
  let open = await request<Array<{ receiptId: string; balance: number; customerName: string }>>("/v1/receivables", {}, stockToken);
  assert.equal(open.length, 1);
  assert.equal(open[0].balance, 9);
  assert.equal((await rawRequest(`/v1/receivables/${fiadoId}/payments`, { method: "POST", body: JSON.stringify({ amount: 20, method: "EFECTIVO" }) }, stockToken)).body.code, "EXCEEDS_BALANCE");
  assert.equal((await rawRequest(`/v1/receivables/${fiadoId}/payments`, { method: "POST", body: JSON.stringify({ amount: 3, method: "CREDITO" }) }, stockToken)).status, 422);
  const stPartial = await request<{ balance: number }>(`/v1/receivables/${fiadoId}/payments`, { method: "POST", body: JSON.stringify({ amount: 4, method: "EFECTIVO" }) }, stockToken);
  assert.equal(stPartial.balance, 5);
  const insights1 = await request<{ receivables: { total: number; customers: number }; lowStock: unknown[]; today: { total: number } }>("/v1/insights", {}, stockToken);
  assert.equal(insights1.receivables.total, 5);
  assert.equal(insights1.receivables.customers, 1);
  assert.ok(insights1.today.total >= 18);
  const stCashClose = await request<{ expectedCash: number; receivableCollections: Array<{ method: string; total: number }> }>("/v1/reports/daily-close", {}, stockToken);
  assert.equal(stCashClose.receivableCollections.find((row) => row.method === "EFECTIVO")?.total, 4);
  await request(`/v1/receivables/${fiadoId}/payments`, { method: "POST", body: JSON.stringify({ amount: 5, method: "YAPE" }) }, stockToken);
  assert.equal((await request<unknown[]>("/v1/receivables", {}, stockToken)).length, 0, "Fully paid stSale leaves the list");
  stProducts = await request("/v1/products", {}, stockToken);
  assert.equal(stProducts.find((p) => p.clientProductId === "arroz-1kg")?.stockQty, 6, "Fiado stSale also decrements stock");
  const lowInsights = await request<{ lowStock: Array<{ name: string }> }>("/v1/insights", {}, stockToken);
  assert.equal(lowInsights.lowStock.length, 0);
  await request("/v1/products/arroz-1kg/stock", { method: "POST", body: JSON.stringify({ mode: "SET", quantity: 2 }) }, stockToken);
  assert.equal((await request<{ lowStock: Array<{ name: string }> }>("/v1/insights", {}, stockToken)).lowStock[0]?.name, "Arroz 1 kg");
  const stKardex = await request<Array<{ reason: string }>>("/v1/products/arroz-1kg/movements", {}, stockToken);
  assert.deepEqual(stKardex.map((m) => m.reason).reverse(), ["INICIAL", "VENTA", "VENTA", "AJUSTE"]);
  // Anular una venta repone el stock (nota de crédito total).
  await request("/v1/products/arroz-1kg/stock", { method: "POST", body: JSON.stringify({ mode: "SET", quantity: 10 }) }, stockToken);
  const voidStock = await rawRequest(`/v1/receipts/${String(stCashSale.body.id)}/void`, { method: "POST", body: JSON.stringify({ reason: "Prueba de reposición" }) }, stockToken);
  assert.ok(voidStock.status === 200 || voidStock.status === 202, `void: ${voidStock.status} ${JSON.stringify(voidStock.body)}`);
  stProducts = await request("/v1/products", {}, stockToken);
  assert.equal(stProducts.find((p) => p.clientProductId === "arroz-1kg")?.stockQty, 12, "Credit note restocks goods");

  log("Seguridad: 2FA, bitácora, bóveda, cabeceras y aislamiento entre negocios");
  const sec = await register(`sec-${suffix}@example.test`);
  const secToken = sec.accessToken;
  const setup = await request<{ secret: string; otpauthUrl: string }>("/v1/auth/mfa/setup", { method: "POST" }, secToken);
  assert.match(setup.otpauthUrl, /^otpauth:\/\/totp\/Faktu:/);
  assert.equal((await rawRequest("/v1/auth/mfa/enable", { method: "POST", body: JSON.stringify({ code: "000000" }) }, secToken)).status, 400, "Wrong TOTP is rejected");
  const enabled = await request<{ recoveryCodes: string[] }>("/v1/auth/mfa/enable", { method: "POST", body: JSON.stringify({ code: totpCode(setup.secret) }) }, secToken);
  assert.equal(enabled.recoveryCodes.length, 8, "Eight recovery codes are shown once");
  const stepOne = await rawRequest("/v1/auth/login", { method: "POST", body: JSON.stringify({ email: `sec-${suffix}@example.test`, password: "E2ePassword123!" }) });
  assert.equal(stepOne.body.mfaRequired, true);
  assert.equal(stepOne.body.accessToken, undefined, "Password alone must not open a session");
  const mfaToken = String(stepOne.body.mfaToken);
  assert.equal((await rawRequest("/v1/auth/me", {}, mfaToken)).status, 401, "MFA step token is not a session");
  assert.equal((await rawRequest("/v1/auth/mfa/verify", { method: "POST", body: JSON.stringify({ mfaToken, code: "123456" === totpCode(setup.secret) ? "654321" : "123456" }) })).status, 401);
  const session = await request<{ accessToken: string }>("/v1/auth/mfa/verify", { method: "POST", body: JSON.stringify({ mfaToken, code: totpCode(setup.secret) }) });
  assert.equal((await rawRequest("/v1/auth/me", {}, session.accessToken)).status, 200);

  // Código de recuperación: sirve una sola vez.
  const recoveryLogin = async () => {
    const first = await rawRequest("/v1/auth/login", { method: "POST", body: JSON.stringify({ email: `sec-${suffix}@example.test`, password: "E2ePassword123!" }) });
    return rawRequest("/v1/auth/mfa/verify", { method: "POST", body: JSON.stringify({ mfaToken: first.body.mfaToken, code: enabled.recoveryCodes[0] }) });
  };
  assert.equal((await recoveryLogin()).status, 200, "Recovery code opens a session");
  assert.equal((await recoveryLogin()).status, 401, "Recovery code cannot be reused");

  // Sesiones: renovación rotativa, reuso detectado y cierre de sesión inmediato.
  const s1 = session as unknown as { accessToken: string; refreshToken: string };
  assert.ok(s1.refreshToken, "Session returns a refresh token");
  const r1 = await request<{ accessToken: string; refreshToken: string }>("/v1/auth/refresh", { method: "POST", body: JSON.stringify({ refreshToken: s1.refreshToken }) });
  assert.notEqual(r1.refreshToken, s1.refreshToken, "Refresh token rotates");
  assert.equal((await rawRequest("/v1/auth/me", {}, s1.accessToken)).status, 401, "Old access token dies with its rotated session");
  assert.equal((await rawRequest("/v1/auth/me", {}, r1.accessToken)).status, 200);
  assert.equal((await rawRequest("/v1/auth/refresh", { method: "POST", body: JSON.stringify({ refreshToken: s1.refreshToken }) })).status, 401, "Reused refresh token is rejected");
  assert.equal((await rawRequest("/v1/auth/me", {}, r1.accessToken)).status, 401, "Reuse revokes the whole device family");
  const fresh = await rawRequest("/v1/auth/mfa/verify", { method: "POST", body: JSON.stringify({ mfaToken: (await rawRequest("/v1/auth/login", { method: "POST", body: JSON.stringify({ email: `sec-${suffix}@example.test`, password: "E2ePassword123!" }) })).body.mfaToken, code: totpCode(setup.secret) }) });
  const freshToken = String(fresh.body.accessToken);
  await request("/v1/auth/logout", { method: "POST" }, freshToken);
  assert.equal((await rawRequest("/v1/auth/me", {}, freshToken)).status, 401, "Logout invalidates the access token immediately");
  const again = await rawRequest("/v1/auth/mfa/verify", { method: "POST", body: JSON.stringify({ mfaToken: (await rawRequest("/v1/auth/login", { method: "POST", body: JSON.stringify({ email: `sec-${suffix}@example.test`, password: "E2ePassword123!" }) })).body.mfaToken, code: totpCode(setup.secret) }) });
  Object.assign(session, again.body);

  const ready = await request<{ ok: boolean; database: string }>("/health/ready");
  assert.equal(ready.database, "up");
  assert.equal((await request<{ demo: unknown }>("/v1/public-config")).demo, null, "Public demo login is off by default");

  assert.equal((await rawRequest("/v1/auth/mfa/disable", { method: "POST", body: JSON.stringify({ code: totpCode(setup.secret) }) }, session.accessToken)).status, 200);

  const audited = await request<Array<{ action: string }>>("/v1/audit", {}, tokenB);
  assert.ok(audited.some((row) => row.action === "RECEIPT_CREATE"), "Receipt creation is audited");
  assert.ok(audited.some((row) => row.action === "STOCK_ADJUST") && audited.some((row) => row.action === "RECEIVABLE_PAYMENT"));
  const auditedA = await request<Array<{ action: string }>>("/v1/audit", {}, tokenA);
  assert.ok(auditedA.some((row) => row.action === "BILLING_TEST_CONNECTION"), "La prueba de conexión del proveedor queda auditada");
  await assert.rejects(() => sql`delete from audit_log`, /de solo agregado/, "Audit log is append-only");

  const health = await fetch(`${apiBase}/health`);
  assert.equal(health.headers.get("x-content-type-options"), "nosniff");
  assert.equal(health.headers.get("x-frame-options"), "DENY");

  // Bóveda: cifrado ligado al dueño; el valor guardado en la base no es el token.
  const sealed = encryptSecret("token-secreto", "tenant-1:billing_token");
  assert.ok(!sealed.includes("token-secreto"));
  assert.equal(decryptSecret(sealed, "tenant-1:billing_token"), "token-secreto");
  assert.throws(() => decryptSecret(sealed, "tenant-2:billing_token"), "A secret moved to another tenant must not decrypt");
  await setTenantSecret(ownerB.user.tenantId, "billing_token", "vault-token-e2e");
  const stored = await sql<{ ciphertext: string }[]>`select ciphertext from tenant_secrets where tenant_id = ${ownerB.user.tenantId}`;
  assert.ok(!stored[0].ciphertext.includes("vault-token-e2e"));
  await loadSecretCache();
  assert.equal(getCachedTenantSecret(ownerB.user.tenantId, "billing_token"), "vault-token-e2e");
  await sql`delete from tenant_secrets where tenant_id = ${ownerB.user.tenantId}`;
  await loadSecretCache();

  // Aislamiento: el negocio A no puede ver ni tocar datos del negocio B (ni al revés).
  const bReceipts = await request<Array<{ id: string; clientTransactionId: string }>>("/v1/receipts", {}, tokenB);
  const bId = bReceipts[0].id;
  assert.equal((await rawRequest(`/v1/receipts/${bId}`, {}, tokenA)).status, 404, "Receipt of another tenant is hidden");
  assert.equal((await rawRequest(`/v1/receipts/${bId}/files/xml`, {}, tokenA)).status, 404);
  assert.equal((await rawRequest(`/v1/receipts/${bId}/void`, { method: "POST", body: JSON.stringify({ reason: "intento ajeno" }) }, tokenA)).status, 404, "Cannot void another tenant receipt");
  assert.notEqual((await rawRequest(`/v1/receivables/${bId}/payments`, { method: "POST", body: JSON.stringify({ amount: 1, method: "EFECTIVO" }) }, tokenA)).status, 200);
  const aProducts = await request<Array<{ clientProductId: string }>>("/v1/products", {}, tokenA);
  assert.ok(!aProducts.some((p) => p.clientProductId === "arroz-1kg"), "Products of another tenant are invisible");
  assert.equal((await rawRequest("/v1/products/arroz-1kg/stock", { method: "POST", body: JSON.stringify({ mode: "SET", quantity: 999 }) }, tokenA)).status, 404);
  assert.equal((await request<unknown[]>("/v1/receivables", {}, tokenA)).length, 0);
  assert.equal((await rawRequest("/v1/receipts", {}, undefined)).status, 401, "No anonymous access");

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

  log("PASS: register -> tenant -> RUC -> DNI cache -> sale -> idempotency -> offline resync -> PDF -> delivery -> validations -> billing security -> payments -> credit note -> daily close -> CSV -> Nubefact (NC parcial, ND, baja, guía) -> APIsPERU (ND, resumen de baja, guía) -> practice mode -> rate limit");
}

main()
  .catch((error) => {
    console.error("[E2E] FAIL", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase().catch(() => undefined);
  });
