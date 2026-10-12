/**
 * Pruebas del adaptador APIsPERU contra el contrato de su OpenAPI oficial
 * (https://facturacion.apisperu.com/doc/swagger), con fetch simulado.
 */
import assert from "node:assert/strict";
import { ApiPeruBillingProvider, classifySunatResult, mapCommandToApiPeru } from "../modules/billing/providers/ApiPeruBillingProvider.js";
import type { BillingIssuer, IssueDocumentCommand } from "../modules/billing/contracts.js";

const issuer: BillingIssuer = {
  ruc: "20601234567",
  legalName: "BODEGA DOÑA ROSA E.I.R.L.",
  tradeName: "BODEGA DOÑA ROSA",
  address: { address: "AV. LOS OLIVOS 123", ubigeo: "150117", department: "LIMA", province: "LIMA", district: "LOS OLIVOS" }
};

const boleta: IssueDocumentCommand = {
  tenantId: "t-1",
  clientTransactionId: "tx-apisperu-0001",
  documentType: "BOLETA",
  series: "B001",
  correlative: 7,
  currency: "PEN",
  issueDate: "2026-10-12T15:00:00.000Z",
  items: [
    { sku: "P1", description: "GASEOSA 500ML", quantity: 2, unitPrice: 3.5, unitCode: "NIU" },
    { description: "PAN", quantity: 1, unitPrice: 5, unitCode: "NIU" }
  ],
  subtotal: 10.17,
  igv: 1.83,
  total: 12
};

const creditNote: IssueDocumentCommand = {
  ...boleta,
  documentType: "NOTA_CREDITO",
  series: "BC01",
  correlative: 1,
  relatedDocument: { documentType: "BOLETA", series: "B001", correlative: 7 },
  creditNoteReason: { code: "01", description: "ANULACION DE LA OPERACION" }
};

type Reply = { status: number; json?: unknown; bytes?: Uint8Array; contentType?: string };
let respond: (url: string, body: Record<string, unknown>) => Reply = () => ({ status: 200, json: {} });
const calls: Array<{ url: string; auth?: string; body: Record<string, unknown> }> = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
  calls.push({ url, auth: (init?.headers as Record<string, string>)?.Authorization, body });
  const reply = respond(url, body);
  if (reply.bytes) return new Response(new Blob([reply.bytes as BlobPart]), { status: reply.status, headers: { "content-type": reply.contentType ?? "application/pdf" } });
  return new Response(JSON.stringify(reply.json ?? {}), { status: reply.status, headers: { "content-type": "application/json" } });
}) as typeof fetch;

const provider = new ApiPeruBillingProvider({ token: "token-empresa", issuer, baseUrl: "https://facturacion.apisperu.com/api/v1/" });
const documentResponse = (sunatResponse: unknown) => ({ status: 200, json: { xml: "<xml/>", hash: "HASH-OK", sunatResponse } });

const tests: Array<[string, () => Promise<void>]> = [
  ["boleta: campos del esquema Invoice (tipoDoc 03, tipoOperacion 0101, company/address)", async () => {
    const json = mapCommandToApiPeru(boleta, issuer) as unknown as Record<string, unknown> & { company: { address: Record<string, string> }; client: Record<string, string> };
    assert.equal(json.tipoDoc, "03");
    assert.equal(json.tipoOperacion, "0101");
    assert.equal(json.correlativo, "7");
    assert.equal(json.company.address.ubigueo, "150117");
    assert.equal(json.client.tipoDoc, "0");
    assert.equal(json.mtoImpVenta, 12);
  }],

  ["nota de crédito: esquema Note (07, tipDocAfectado, numDocfectado, codMotivo) sin tipoOperacion", async () => {
    const json = mapCommandToApiPeru(creditNote, issuer) as unknown as Record<string, unknown>;
    assert.equal(json.tipoDoc, "07");
    assert.equal(json.tipDocAfectado, "03");
    assert.equal(json.numDocfectado, "B001-7");
    assert.equal(json.codMotivo, "01");
    assert.equal(json.tipoOperacion, undefined);
    assert.equal(json.formaPago, undefined);
  }],

  ["envío aceptado: Bearer token del negocio, hash y CDR", async () => {
    calls.length = 0;
    respond = () => documentResponse({ success: true, cdrZip: "CDR", cdrResponse: { accepted: true, id: "B001-7", code: "0", description: "La Boleta numero B001-7, ha sido aceptada" } });
    const result = await provider.issueDocument(boleta);
    assert.equal(calls[0].url, "https://facturacion.apisperu.com/api/v1/invoice/send");
    assert.equal(calls[0].auth, "Bearer token-empresa");
    assert.equal(result.status, "ACCEPTED");
    assert.equal(result.artifacts?.hash, "HASH-OK");
  }],

  ["aceptado con observaciones (4xxx) sigue siendo ACEPTADO", async () => {
    respond = () => documentResponse({ success: true, cdrResponse: { accepted: true, id: "B001-7", code: "4252", description: "Observación" } });
    assert.equal((await provider.issueDocument(boleta)).status, "ACCEPTED");
  }],

  ["nota de crédito va a note/send", async () => {
    calls.length = 0;
    respond = () => documentResponse({ success: true, cdrResponse: { accepted: true, id: "BC01-1", code: "0" } });
    await provider.issueDocument(creditNote);
    assert.equal(calls[0].url, "https://facturacion.apisperu.com/api/v1/note/send");
  }],

  ["errores de validación (400, lista field/message) → RECHAZADO con el detalle", async () => {
    respond = () => ({ status: 400, json: [{ field: "client.numDoc", message: "El número de documento no es válido" }] });
    const result = await provider.issueDocument(boleta);
    assert.equal(result.status, "REJECTED");
    assert.match(result.message, /client\.numDoc: El número de documento no es válido/);
  }],

  ["rechazo SUNAT (2xxx) → RECHAZADO con código", async () => {
    respond = () => documentResponse({ success: false, error: { code: "2017", message: "El numero de documento de identidad del receptor debe ser RUC" } });
    const result = await provider.issueDocument(boleta);
    assert.equal(result.status, "REJECTED");
    assert.match(result.message, /código SUNAT 2017/);
  }],

  ["intermitencia de SUNAT (0109 / error HTTP) → PENDIENTE, nunca rechazo", async () => {
    respond = () => documentResponse({ success: false, error: { code: "0109", message: "El sistema de recepción no está disponible" } });
    assert.equal((await provider.issueDocument(boleta)).status, "PENDING");
    respond = () => documentResponse({ success: false, error: { code: "HTTP", message: "Service Unavailable" } });
    assert.equal((await provider.issueDocument(boleta)).status, "PENDING");
  }],

  ["1033 (registrado previamente) → PENDIENTE para conciliar", async () => {
    respond = () => documentResponse({ success: false, error: { code: "1033", message: "El comprobante fue registrado previamente con otros datos" } });
    assert.equal((await provider.issueDocument(boleta)).status, "PENDING");
  }],

  ["credencial inválida (401) es error de configuración", async () => {
    respond = () => ({ status: 401, json: { message: "Unauthorized" } });
    await assert.rejects(provider.issueDocument(boleta), /credencial/);
  }],

  ["consulta de estado: GET invoice/status con tipo/serie/numero/ruc", async () => {
    calls.length = 0;
    respond = () => ({ status: 200, json: { success: true, cdrResponse: { accepted: true, id: "B001-7", code: "0" } } });
    const result = await provider.getDocumentStatus(boleta);
    const url = new URL(calls[0].url);
    assert.equal(url.pathname, "/api/v1/invoice/status");
    assert.deepEqual([url.searchParams.get("tipo"), url.searchParams.get("serie"), url.searchParams.get("numero"), url.searchParams.get("ruc")], ["03", "B001", "7", "20601234567"]);
    assert.equal(result.status, "ACCEPTED");
  }],

  ["consulta sin CDR todavía (aunque traiga error) → PENDIENTE", async () => {
    respond = () => ({ status: 200, json: { success: false, error: { code: "0127", message: "El ticket no existe" } } });
    assert.equal((await provider.getDocumentStatus(boleta)).status, "PENDING");
  }],

  ["PDF oficial: POST invoice/pdf devuelve el PDF", async () => {
    calls.length = 0;
    respond = () => ({ status: 200, bytes: new TextEncoder().encode("%PDF-1.4 oficial") });
    const pdf = await provider.getDocumentPdf(boleta);
    assert.equal(calls[0].url, "https://facturacion.apisperu.com/api/v1/invoice/pdf");
    assert.equal(pdf.subarray(0, 4).toString("ascii"), "%PDF");
    respond = () => ({ status: 200, bytes: new TextEncoder().encode("%PDF-1.4 nota") });
    await provider.getDocumentPdf(creditNote);
    assert.equal(calls[1].url, "https://facturacion.apisperu.com/api/v1/note/pdf");
  }],

  ["PDF: si la respuesta no es un PDF, falla explícitamente", async () => {
    respond = () => ({ status: 400, json: [{ field: "company", message: "requerido" }] });
    await assert.rejects(provider.getDocumentPdf(boleta), /no generó el PDF/);
  }],

  ["clasificación SUNAT sin respuesta → PENDIENTE", async () => {
    assert.equal(classifySunatResult(undefined), "PENDING");
    assert.equal(classifySunatResult({ success: true }), "PENDING");
    assert.equal(classifySunatResult({ cdrResponse: { accepted: false, code: "2800" } }), "REJECTED");
  }]
];

let failed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  ✗ ${name}\n    ${error instanceof Error ? error.message : String(error)}`);
  }
}
globalThis.fetch = originalFetch;
console.log(failed ? `APISPERU ADAPTER: ${failed} FAILED` : `APISPERU ADAPTER: ${tests.length} PASS`);
process.exit(failed ? 1 : 0);
