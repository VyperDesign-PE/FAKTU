/**
 * Pruebas del adaptador Nubefact con respuestas tomadas del manual oficial
 * (sin red: fetch simulado).
 */
import assert from "node:assert/strict";
import { mapCommandToNubefact, mapDespatchToNubefact, NubefactBillingProvider } from "../modules/billing/providers/NubefactBillingProvider.js";
import type { DespatchCommand, IssueDocumentCommand, VoidingCommand } from "../modules/billing/contracts.js";

const boleta: IssueDocumentCommand = {
  tenantId: "t-1",
  clientTransactionId: "tx-nubefact-0001",
  documentType: "BOLETA",
  series: "BBB1",
  correlative: 15,
  currency: "PEN",
  issueDate: "2026-10-12T03:30:00.000Z", // 11-10-2026 22:30 en Lima
  items: [
    { sku: "P1", description: "GASEOSA 500ML", quantity: 2, unitPrice: 3.5, unitCode: "NIU" },
    { description: "DELIVERY", quantity: 1, unitPrice: 5, unitCode: "Servicio" }
  ],
  subtotal: 10.17,
  igv: 1.83,
  total: 12,
  paymentMethod: "YAPE"
};

const factura: IssueDocumentCommand = {
  ...boleta,
  documentType: "FACTURA",
  series: "FFF1",
  correlative: 3,
  customer: { documentType: "RUC", documentNumber: "20600695771", name: "NUBEFACT SA", address: "CALLE LIBERTAD 116 MIRAFLORES" }
};

type Call = { url: string; headers: Record<string, string>; body: Record<string, unknown> };
const calls: Call[] = [];
let respond: (body: Record<string, unknown>) => { status: number; json: unknown } = () => ({ status: 200, json: {} });

const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
  calls.push({ url: String(input), headers: init?.headers as Record<string, string>, body });
  const reply = respond(body);
  return new Response(JSON.stringify(reply.json), { status: reply.status, headers: { "content-type": "application/json" } });
}) as typeof fetch;

const provider = new NubefactBillingProvider({ url: "https://api.nubefact.com/api/v1/ruta-prueba", token: "token-prueba" });
const accepted = (serie: string, numero: number) => ({
  status: 200,
  json: {
    tipo_de_comprobante: 2, serie, numero,
    enlace: "https://www.nubefact.com/cpe/abc",
    enlace_del_pdf: "https://www.nubefact.com/cpe/abc.pdf",
    enlace_del_xml: "https://www.nubefact.com/cpe/abc.xml",
    enlace_del_cdr: "https://www.nubefact.com/cpe/abc.cdr",
    aceptada_por_sunat: true,
    sunat_description: `La Boleta numero ${serie}-${numero}, ha sido aceptada`,
    sunat_responsecode: "0",
    cadena_para_codigo_qr: "20600695771 | 03 | BBB1 | 000015 | ...",
    codigo_hash: "xMLFMnbgp1/bHEy572RKRTE9hPY="
  }
});

const tests: Array<[string, () => Promise<void>]> = [
  ["mapea la boleta según el manual (tipo 2, fecha DD-MM-AAAA en Lima, cliente varios)", async () => {
    const json = mapCommandToNubefact(boleta) as Record<string, unknown> & { items: Array<Record<string, unknown>> };
    assert.equal(json.operacion, "generar_comprobante");
    assert.equal(json.tipo_de_comprobante, 2);
    assert.equal(json.numero, 15);
    assert.equal(json.fecha_de_emision, "11-10-2026");
    assert.equal(json.cliente_tipo_de_documento, "-");
    assert.equal(json.moneda, 1);
    assert.equal(json.medio_de_pago, "YAPE");
    assert.equal(json.items[1].unidad_de_medida, "ZZ");
    assert.equal(json.items[0].tipo_de_igv, 1);
  }],

  ["la suma de líneas cuadra con total_gravada, total_igv y total", async () => {
    const json = mapCommandToNubefact(boleta) as { total_gravada: number; total_igv: number; total: number; items: Array<{ subtotal: number; igv: number; total: number }> };
    const cents = (n: number) => Math.round(n * 100);
    assert.equal(json.items.reduce((s, i) => s + cents(i.subtotal), 0), cents(json.total_gravada));
    assert.equal(json.items.reduce((s, i) => s + cents(i.igv), 0), cents(json.total_igv));
    assert.equal(json.items.reduce((s, i) => s + cents(i.total), 0), cents(json.total));
    assert.equal(json.total, 12);
  }],

  ["factura exige RUC y dirección del cliente", async () => {
    assert.throws(() => mapCommandToNubefact({ ...factura, customer: { ...factura.customer!, address: undefined } }), /dirección/);
    const json = mapCommandToNubefact(factura) as Record<string, unknown>;
    assert.equal(json.tipo_de_comprobante, 1);
    assert.equal(json.cliente_tipo_de_documento, "6");
  }],

  ["nota de crédito de anulación referencia el comprobante original", async () => {
    const json = mapCommandToNubefact({
      ...boleta,
      documentType: "NOTA_CREDITO",
      series: "BBB1",
      correlative: 16,
      relatedDocument: { documentType: "BOLETA", series: "BBB1", correlative: 15 },
      noteReason: { code: "01", description: "ANULACIÓN DE LA OPERACIÓN" }
    }) as Record<string, unknown>;
    assert.equal(json.tipo_de_comprobante, 3);
    assert.equal(json.documento_que_se_modifica_tipo, 2);
    assert.equal(json.documento_que_se_modifica_serie, "BBB1");
    assert.equal(json.documento_que_se_modifica_numero, 15);
    assert.equal(json.tipo_de_nota_de_credito, 1);
    assert.equal(json.medio_de_pago, undefined);
  }],

  ["envía a la ruta con Authorization = token y queda ACEPTADO con PDF oficial", async () => {
    calls.length = 0;
    respond = () => accepted("BBB1", 15);
    const result = await provider.issueDocument(boleta);
    assert.equal(calls[0].url, "https://api.nubefact.com/api/v1/ruta-prueba");
    assert.equal(calls[0].headers.Authorization, "token-prueba");
    assert.equal(result.status, "ACCEPTED");
    assert.equal(result.officialNumber, "BBB1-00000015");
    assert.equal(result.pdfUrl, "https://www.nubefact.com/cpe/abc.pdf");
    assert.equal(result.artifacts?.hash, "xMLFMnbgp1/bHEy572RKRTE9hPY=");
    assert.ok(result.artifacts?.qrData);
  }],

  ["código 23 (ya existe) NO es rechazo: queda pendiente para conciliar", async () => {
    respond = () => ({ status: 400, json: { errors: "Este documento ya existe en NubeFacT", codigo: 23 } });
    const result = await provider.issueDocument(boleta);
    assert.equal(result.status, "PENDING");
  }],

  ["conciliación: consultar_comprobante recupera el aceptado", async () => {
    calls.length = 0;
    respond = (body) => body.operacion === "consultar_comprobante" ? accepted("BBB1", 15) : { status: 500, json: {} };
    const result = await provider.getDocumentStatus(boleta);
    assert.equal(calls[0].body.operacion, "consultar_comprobante");
    assert.equal(calls[0].body.tipo_de_comprobante, 2);
    assert.equal(result.status, "ACCEPTED");
  }],

  ["conciliación: código 24 (no existe) queda pendiente para reenviar", async () => {
    respond = () => ({ status: 400, json: { errors: "El documento indicado no existe o no fue enviado a NubeFacT", codigo: 24 } });
    const result = await provider.getDocumentStatus(boleta);
    assert.equal(result.status, "PENDING");
  }],

  ["rechazo de SUNAT (código 2xxx) queda RECHAZADO", async () => {
    respond = () => ({ status: 200, json: { aceptada_por_sunat: false, sunat_responsecode: "2017", sunat_description: "El numero de documento de identidad del receptor debe ser RUC" } });
    const result = await provider.issueDocument(boleta);
    assert.equal(result.status, "REJECTED");
    assert.match(result.message, /RUC/);
  }],

  ["recibido sin respuesta de SUNAT todavía: pendiente", async () => {
    respond = () => ({ status: 200, json: { aceptada_por_sunat: false, sunat_responsecode: null, sunat_soap_error: "" , enlace: "https://www.nubefact.com/cpe/x" } });
    assert.equal((await provider.issueDocument(boleta)).status, "PENDING");
  }],

  ["formato inválido (código 20) es rechazo con el mensaje de Nubefact", async () => {
    respond = () => ({ status: 400, json: { errors: "El archivo enviado no cumple con el formato establecido", codigo: 20 } });
    const result = await provider.issueDocument(boleta);
    assert.equal(result.status, "REJECTED");
    assert.match(result.message, /formato/);
  }],

  ["token inválido (código 10) es error de configuración, no rechazo", async () => {
    respond = () => ({ status: 401, json: { errors: "No se pudo autenticar, token incorrecto o eliminado", codigo: 10 } });
    await assert.rejects(provider.issueDocument(boleta), /configuración de la cuenta/);
    assert.equal(await provider.health(), "DOWN");
  }],

  ["red caída tras el POST: pendiente, nunca rechazo", async () => {
    const previous = globalThis.fetch;
    globalThis.fetch = (async () => { throw new TypeError("connection reset"); }) as typeof fetch;
    try {
      assert.equal((await provider.issueDocument(boleta)).status, "PENDING");
    } finally {
      globalThis.fetch = previous;
    }
  }],

  ["health: consulta de documento inexistente (24) significa cuenta válida", async () => {
    respond = () => ({ status: 400, json: { errors: "no existe", codigo: 24 } });
    assert.equal(await provider.health(), "UP");
  }]
];

const voiding: VoidingCommand = {
  tenantId: "t-1", voidingId: "v-1", kind: "COMUNICACION_BAJA", correlative: 1, reason: "Error en el precio",
  communicationDate: "2026-10-12T15:00:00.000Z",
  document: { documentType: "FACTURA", series: "FFF1", correlative: 3, issueDate: "2026-10-12T15:00:00.000Z", subtotal: 10.17, igv: 1.83, total: 12 }
};
const guide: DespatchCommand = {
  tenantId: "t-1", guideId: "g-1", guideType: "REMITENTE", series: "TTT1", correlative: 1, issueDate: "2026-10-12T15:00:00.000Z",
  data: {
    recipient: { documentType: "6", documentNumber: "20600695771", name: "NUBEFACT SA", address: "MIRAFLORES LIMA" },
    reasonCode: "01", transportMode: "02", transferDate: "2026-10-13", grossWeight: 12.5, weightUnit: "KGM", packages: 3,
    origin: { ubigeo: "150101", address: "AV. ORIGEN 123" }, destination: { ubigeo: "150122", address: "AV. LLEGADA 456" },
    vehiclePlate: "ABC444", driver: { documentType: "1", documentNumber: "45678912", names: "JORGE", surnames: "LOPEZ", license: "Q45678912" },
    items: [{ code: "P1", description: "GASEOSA 500ML x 24", quantity: 10, unit: "NIU" }],
    relatedDocument: { documentType: "FACTURA", series: "FFF1", correlative: 3 }
  }
};

tests.push(
  ["nota de débito: tipo 4 con tipo_de_nota_de_debito y documento modificado", async () => {
    const json = mapCommandToNubefact({
      ...boleta, documentType: "NOTA_DEBITO", series: "BBB1", correlative: 20,
      relatedDocument: { documentType: "BOLETA", series: "BBB1", correlative: 15 },
      noteReason: { code: "02", description: "AUMENTO EN EL VALOR" }
    }) as Record<string, unknown>;
    assert.equal(json.tipo_de_comprobante, 4);
    assert.equal(json.tipo_de_nota_de_debito, 2);
    assert.equal(json.tipo_de_nota_de_credito, undefined);
    assert.equal(json.documento_que_se_modifica_numero, 15);
  }],
  ["baja: generar_anulacion con motivo; pendiente con ticket y luego aceptada al consultar", async () => {
    calls.length = 0;
    respond = (body) => body.operacion === "generar_anulacion"
      ? { status: 200, json: { numero: 3, sunat_ticket_numero: "1494358661332", aceptada_por_sunat: false, sunat_responsecode: null } }
      : { status: 200, json: { numero: 3, sunat_ticket_numero: "1494358661332", aceptada_por_sunat: true, sunat_description: "La Comunicacion de baja ha sido aceptada" } };
    const sent = await provider.requestVoiding(voiding);
    assert.deepEqual([calls[0].body.operacion, calls[0].body.tipo_de_comprobante, calls[0].body.serie, calls[0].body.numero, calls[0].body.motivo], ["generar_anulacion", 1, "FFF1", 3, "ERROR EN EL PRECIO"]);
    assert.equal(sent.status, "PENDING");
    assert.equal(sent.ticket, "1494358661332");
    const checked = await provider.getVoidingStatus(voiding);
    assert.equal(calls[1].body.operacion, "consultar_anulacion");
    assert.equal(checked.status, "ACCEPTED");
  }],
  ["baja fuera de plazo (código 22) → RECHAZADA", async () => {
    respond = () => ({ status: 400, json: { errors: "Documento enviado fuera del plazo permitido", codigo: 22 } });
    assert.equal((await provider.requestVoiding(voiding)).status, "REJECTED");
  }],
  ["guía remitente (transporte privado): campos del manual GRE", async () => {
    const json = mapDespatchToNubefact(guide) as Record<string, unknown> & { items: Array<Record<string, unknown>>; documento_relacionado: Array<Record<string, unknown>> };
    assert.equal(json.operacion, "generar_guia");
    assert.equal(json.tipo_de_comprobante, 7);
    assert.equal(json.cliente_numero_de_documento, "20600695771");
    assert.equal(json.motivo_de_traslado, "01");
    assert.equal(json.tipo_de_transporte, "02");
    assert.equal(json.fecha_de_inicio_de_traslado, "13-10-2026");
    assert.equal(json.transportista_placa_numero, "ABC444");
    assert.equal(json.conductor_numero_licencia, "Q45678912");
    assert.equal(json.transportista_documento_numero, undefined);
    assert.equal(json.punto_de_llegada_ubigeo, "150122");
    assert.equal(json.items[0].cantidad, "10");
    assert.deepEqual(json.documento_relacionado[0], { tipo: "01", serie: "FFF1", numero: "3" });
  }],
  ["guía transporte público exige transportista; transportista usa destinatario_*", async () => {
    assert.throws(() => mapDespatchToNubefact({ ...guide, data: { ...guide.data, transportMode: "01" } }), /empresa de transportes/);
    const publicJson = mapDespatchToNubefact({ ...guide, data: { ...guide.data, transportMode: "01", carrier: { documentNumber: "20100000001", name: "TRANSPORTES SAC" }, vehiclePlate: undefined, driver: undefined } }) as Record<string, unknown>;
    assert.equal(publicJson.transportista_documento_numero, "20100000001");
    assert.equal(publicJson.conductor_documento_numero, undefined);
    const carrierJson = mapDespatchToNubefact({ ...guide, guideType: "TRANSPORTISTA", series: "VVV1", data: { ...guide.data, shipper: { documentType: "6", documentNumber: "20555555555", name: "REMITENTE SA" } } }) as Record<string, unknown>;
    assert.equal(carrierJson.tipo_de_comprobante, 8);
    assert.equal(carrierJson.cliente_numero_de_documento, "20555555555");
    assert.equal(carrierJson.destinatario_documento_numero, "20600695771");
    assert.equal(carrierJson.motivo_de_traslado, undefined);
  }],
  ["guía: pendiente al generar; consultar_guia la acepta con PDF", async () => {
    calls.length = 0;
    respond = (body) => body.operacion === "generar_guia"
      ? { status: 200, json: { tipo_de_comprobante: 7, serie: "TTT1", numero: 1, aceptada_por_sunat: false } }
      : { status: 200, json: { tipo_de_comprobante: 7, serie: "TTT1", numero: 1, aceptada_por_sunat: true, enlace_del_pdf: "https://www.nubefact.com/guia/x.pdf", sunat_description: "aceptada" } };
    assert.equal((await provider.issueDespatch(guide)).status, "PENDING");
    const checked = await provider.getDespatchStatus(guide);
    assert.equal(calls[1].body.operacion, "consultar_guia");
    assert.equal(checked.status, "ACCEPTED");
    assert.equal(checked.pdfUrl, "https://www.nubefact.com/guia/x.pdf");
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
console.log(failed ? `NUBEFACT ADAPTER: ${failed} FAILED` : `NUBEFACT ADAPTER: ${tests.length} PASS`);
process.exit(failed ? 1 : 0);
