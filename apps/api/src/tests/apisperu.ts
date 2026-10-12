/**
 * Pruebas del adaptador APIsPERU contra el contrato de su OpenAPI oficial
 * (https://facturacion.apisperu.com/doc/swagger), con fetch simulado.
 */
import assert from "node:assert/strict";
import { ApiPeruBillingProvider, classifySunatResult, mapCommandToApiPeru, mapDespatchToApiPeru, mapVoidingToApiPeru } from "../modules/billing/providers/ApiPeruBillingProvider.js";
import type { BillingIssuer, DespatchCommand, IssueDocumentCommand, VoidingCommand } from "../modules/billing/contracts.js";

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
  noteReason: { code: "01", description: "ANULACION DE LA OPERACION" }
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

const facturaVoiding: VoidingCommand = {
  tenantId: "t-1", voidingId: "v-1", kind: "COMUNICACION_BAJA", correlative: 7, reason: "Error en cálculos",
  communicationDate: "2026-10-14T15:00:00.000Z",
  document: { documentType: "FACTURA", series: "F001", correlative: 25, issueDate: "2026-10-12T15:00:00.000Z", subtotal: 100, igv: 18, total: 118 }
};
const boletaVoiding: VoidingCommand = {
  ...facturaVoiding, kind: "RESUMEN_BAJA",
  document: { documentType: "BOLETA", series: "B001", correlative: 7, issueDate: "2026-10-12T15:00:00.000Z", subtotal: 10.17, igv: 1.83, total: 12 }
};
const despatch: DespatchCommand = {
  tenantId: "t-1", guideId: "g-1", guideType: "REMITENTE", series: "T001", correlative: 5, issueDate: "2026-10-12T15:00:00.000Z",
  data: {
    recipient: { documentType: "6", documentNumber: "20000000002", name: "EMPRESA A" },
    reasonCode: "01", transportMode: "01", transferDate: "2026-10-13", grossWeight: 12.5, weightUnit: "KGM", packages: 2,
    origin: { ubigeo: "150203", address: "AV ITALIA" }, destination: { ubigeo: "150101", address: "AV LIMA" },
    carrier: { documentNumber: "20000000003", name: "TRANSPORTES S.A.C", mtcNumber: "MTC123" },
    items: [{ code: "PROD1", description: "PRODUCTO 1", quantity: 2, unit: "NIU" }],
    relatedDocument: { documentType: "FACTURA", series: "F001", correlative: 25 }
  }
};

tests.push(
  ["nota de débito: esquema Note con tipoDoc 08 por note/send", async () => {
    const json = mapCommandToApiPeru({ ...creditNote, documentType: "NOTA_DEBITO", series: "BD01", noteReason: { code: "02", description: "AUMENTO EN EL VALOR" } }, issuer) as unknown as Record<string, unknown>;
    assert.equal(json.tipoDoc, "08");
    assert.equal(json.codMotivo, "02");
    calls.length = 0;
    respond = () => documentResponse({ success: true, cdrResponse: { accepted: true, id: "BD01-1", code: "0" } });
    await provider.issueDocument({ ...creditNote, documentType: "NOTA_DEBITO", series: "BD01", noteReason: { code: "02", description: "AUMENTO" } });
    assert.equal(calls[0].url, "https://facturacion.apisperu.com/api/v1/note/send");
  }],
  ["baja de factura: voided/send como el ejemplo oficial", async () => {
    const { path, body } = mapVoidingToApiPeru(facturaVoiding, issuer) as { path: string; body: Record<string, unknown> & { details: Array<Record<string, string>> } };
    assert.equal(path, "voided/send");
    assert.equal(body.correlativo, "007");
    assert.equal(body.fecGeneracion, "2026-10-12T00:00:00-05:00");
    assert.equal(body.fecComunicacion, "2026-10-14T00:00:00-05:00");
    assert.deepEqual(body.details[0], { tipoDoc: "01", serie: "F001", correlativo: "25", desMotivoBaja: "ERROR EN CÁLCULOS" });
  }],
  ["baja de boleta: resumen diario (summary/send) con estado 3", async () => {
    const { path, body } = mapVoidingToApiPeru(boletaVoiding, issuer) as { path: string; body: Record<string, unknown> & { details: Array<Record<string, unknown>> } };
    assert.equal(path, "summary/send");
    assert.equal(body.moneda, "PEN");
    assert.equal(body.details[0].serieNro, "B001-7");
    assert.equal(body.details[0].estado, "3");
    assert.equal(body.details[0].total, 12);
  }],
  ["baja: envío devuelve ticket (pendiente) y voided/status con CDR aceptado la confirma", async () => {
    calls.length = 0;
    respond = (url) => url.includes("/voided/send")
      ? { status: 200, json: { xml: "<x/>", hash: "h", sunatResponse: { success: true, ticket: "1703154974517" } } }
      : { status: 200, json: { success: true, cdrResponse: { accepted: true, id: "RA-20261014-7", code: "0", description: "aceptada" } } };
    const sent = await provider.requestVoiding(facturaVoiding);
    assert.equal(sent.status, "PENDING");
    assert.equal(sent.ticket, "1703154974517");
    const checked = await provider.getVoidingStatus(facturaVoiding, sent.ticket);
    const url = new URL(calls[1].url);
    assert.equal(url.pathname, "/api/v1/voided/status");
    assert.equal(url.searchParams.get("ticket"), "1703154974517");
    assert.equal(checked.status, "ACCEPTED");
    const summaryCheck = await provider.getVoidingStatus(boletaVoiding, "T2");
    assert.equal(new URL(calls[2].url).pathname, "/api/v1/summary/status");
    assert.equal(summaryCheck.status, "ACCEPTED");
  }],
  ["baja: ticket aún en proceso (sin CDR) → pendiente", async () => {
    respond = () => ({ status: 200, json: { success: false, code: "98", error: { code: "98", message: "En proceso" } } });
    assert.equal((await provider.getVoidingStatus(facturaVoiding, "T")).status, "PENDING");
  }],
  ["guía remitente: Despatch versión 2022 como el ejemplo oficial (transporte público)", async () => {
    const json = mapDespatchToApiPeru(despatch, issuer) as unknown as Record<string, unknown> & { envio: Record<string, unknown>; addDocs: Array<Record<string, string>> };
    assert.equal(json.version, 2022);
    assert.equal(json.tipoDoc, "09");
    assert.equal(json.envio.codTraslado, "01");
    assert.equal(json.envio.desTraslado, "VENTA");
    assert.equal(json.envio.modTraslado, "01");
    assert.equal(json.envio.fecTraslado, "2026-10-13T00:00:00-05:00");
    assert.deepEqual(json.envio.transportista, { tipoDoc: "6", numDoc: "20000000003", rznSocial: "TRANSPORTES S.A.C", nroMtc: "MTC123" });
    assert.equal(json.envio.vehiculo, undefined);
    assert.deepEqual(json.envio.partida, { ubigueo: "150203", direccion: "AV ITALIA" });
    assert.equal(json.addDocs[0].nro, "F001-25");
  }],
  ["guía transporte privado y transportista (31): vehículo y chofer", async () => {
    const privateJson = mapDespatchToApiPeru({ ...despatch, data: { ...despatch.data, transportMode: "02", carrier: undefined, vehiclePlate: "ABI453", driver: { documentType: "1", documentNumber: "40003344", names: "LUIS", surnames: "GARCIA", license: "M46545654" } } }, issuer) as unknown as { envio: Record<string, unknown> };
    assert.deepEqual(privateJson.envio.vehiculo, { placa: "ABI453" });
    assert.equal((privateJson.envio.choferes as Array<Record<string, string>>)[0].licencia, "M46545654");
    const carrierJson = mapDespatchToApiPeru({ ...despatch, guideType: "TRANSPORTISTA", series: "V001", data: { ...despatch.data, transportMode: undefined, carrier: undefined, shipper: { documentType: "6", documentNumber: "20000000004", name: "EMPRESA B" }, vehiclePlate: "ABITR564", driver: { documentType: "1", documentNumber: "79214014", names: "LUIS", surnames: "GARCIA", license: "M46545654" } } }, issuer) as unknown as Record<string, unknown>;
    assert.equal(carrierJson.tipoDoc, "31");
    assert.deepEqual(carrierJson.remitente, { tipoDoc: "6", numDoc: "20000000004", rznSocial: "EMPRESA B" });
  }],
  ["guía: despatch/send con ticket → despatch/status aceptada; PDF por despatch/pdf", async () => {
    calls.length = 0;
    respond = (url) => url.includes("/despatch/send")
      ? { status: 200, json: { xml: "<x/>", hash: "h", sunatResponse: { success: true, ticket: "GRE-1" } } }
      : url.includes("/despatch/status")
        ? { status: 200, json: { success: true, cdrResponse: { accepted: true, id: "T001-5", code: "0" } } }
        : { status: 200, bytes: new TextEncoder().encode("%PDF-1.4 guia") };
    const sent = await provider.issueDespatch(despatch);
    assert.equal(sent.status, "PENDING");
    assert.equal(sent.ticket, "GRE-1");
    assert.equal((await provider.getDespatchStatus(despatch, "GRE-1")).status, "ACCEPTED");
    const pdf = await provider.getDespatchPdf(despatch);
    assert.equal(calls[2].url, "https://facturacion.apisperu.com/api/v1/despatch/pdf");
    assert.equal(pdf.subarray(0, 4).toString("ascii"), "%PDF");
  }]
);

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
