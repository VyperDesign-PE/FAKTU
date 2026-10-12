import { randomUUID } from "node:crypto";
import { sql } from "../../db/client.js";
import type { BillingService } from "../billing/BillingService.js";
import type { DespatchCommand, DespatchData, DespatchGuideType, DespatchResult } from "../billing/contracts.js";
import { PRACTICE_SERIES } from "../billing/practiceMode.js";
import { getTenantBillingConfig } from "../billing/tenantBillingConfigRepository.js";
import { getReceiptById } from "../receipts/receiptRepository.js";
import { renderLinesPdf, wrapText, type PdfLine } from "../sharing/receiptPdf.js";
import type { BusinessRecord } from "../tenants/tenantRepository.js";

/**
 * Guías de remisión electrónicas (GRE) remitente y transportista.
 *
 * SUNAT las acepta de forma asíncrona: se envían, quedan PENDIENTES y el
 * servidor consulta su estado (ticket en APIsPERU, consultar_guia en
 * Nubefact) hasta que se aceptan o rechazan. Con ticket nunca se reenvían.
 */
export type GuideStatus = "PENDIENTE" | "ENVIANDO" | "ACEPTADO" | "RECHAZADO" | "ERROR";

export type GuideRecord = {
  id: string;
  tenantId: string;
  clientTransactionId: string;
  guideType: DespatchGuideType;
  series: string;
  correlative: number;
  issueDate: string;
  transferDate: string;
  data: DespatchData;
  relatedReceiptId?: string;
  status: GuideStatus;
  providerCode?: string;
  ticket?: string;
  message?: string;
  pdfUrl?: string;
  hash?: string;
  attemptCount: number;
  practice: boolean;
};

type GuideRow = {
  id: string;
  tenant_id: string;
  client_transaction_id: string;
  guide_type: DespatchGuideType;
  series: string;
  correlative: string | number;
  issue_date: Date | string;
  transfer_date: Date | string;
  data: DespatchData;
  related_receipt_id: string | null;
  status: GuideStatus;
  provider_code: string | null;
  ticket: string | null;
  message: string | null;
  provider_pdf_url: string | null;
  provider_hash: string | null;
  attempt_count: number;
  is_practice: boolean;
};

export class GuideError extends Error {
  constructor(readonly code: string, message: string, readonly statusCode = 422) {
    super(message);
    this.name = "GuideError";
  }
}

const STALE_SENDING_SECONDS = Number(process.env.RECEIPT_STALE_SENDING_SECONDS ?? 120);

function mapGuide(row: GuideRow): GuideRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clientTransactionId: row.client_transaction_id,
    guideType: row.guide_type,
    series: row.series,
    correlative: Number(row.correlative),
    issueDate: new Date(row.issue_date).toISOString(),
    transferDate: typeof row.transfer_date === "string" ? row.transfer_date.slice(0, 10) : new Date(row.transfer_date).toISOString().slice(0, 10),
    data: row.data,
    relatedReceiptId: row.related_receipt_id ?? undefined,
    status: row.status,
    providerCode: row.provider_code ?? undefined,
    ticket: row.ticket ?? undefined,
    message: row.message ?? undefined,
    pdfUrl: row.provider_pdf_url ?? undefined,
    hash: row.provider_hash ?? undefined,
    attemptCount: row.attempt_count,
    practice: row.is_practice
  };
}

function seriesFor(guideType: DespatchGuideType, practice: boolean) {
  if (practice) return guideType === "REMITENTE" ? PRACTICE_SERIES.GUIA_REMITENTE : PRACTICE_SERIES.GUIA_TRANSPORTISTA;
  return guideType === "REMITENTE"
    ? process.env.DEFAULT_GUIA_REMITENTE_SERIES ?? "T001"
    : process.env.DEFAULT_GUIA_TRANSPORTISTA_SERIES ?? "V001";
}

/** Reglas de SUNAT que conviene validar antes de reservar un número. */
export function assertGuideRules(guideType: DespatchGuideType, data: DespatchData) {
  if (guideType === "REMITENTE") {
    if (!data.reasonCode) throw new GuideError("REASON_REQUIRED", "Indica el motivo del traslado.");
    if (data.reasonCode === "13" && !data.reasonDescription?.trim()) throw new GuideError("REASON_DESCRIPTION_REQUIRED", "Describe el motivo del traslado (OTROS).");
    if (!data.transportMode) throw new GuideError("MODE_REQUIRED", "Indica si el transporte es público o privado.");
    if (data.transportMode === "01" && !data.carrier) throw new GuideError("CARRIER_REQUIRED", "El transporte público requiere el RUC y nombre de la empresa de transportes.");
  } else if (!data.shipper) {
    throw new GuideError("SHIPPER_REQUIRED", "La guía de transportista requiere los datos del remitente.");
  }
  const ownVehicle = guideType === "TRANSPORTISTA" || data.transportMode === "02";
  if (ownVehicle && (!data.vehiclePlate || !data.driver)) {
    throw new GuideError("VEHICLE_REQUIRED", "Indica la placa del vehículo y los datos del conductor.");
  }
  if (!(data.grossWeight > 0)) throw new GuideError("WEIGHT_REQUIRED", "El peso bruto total debe ser mayor a 0.");
  if (!data.items.length) throw new GuideError("ITEMS_REQUIRED", "Agrega al menos un bien a trasladar.");
  if (data.origin.ubigeo === data.destination.ubigeo && data.origin.address.trim().toUpperCase() === data.destination.address.trim().toUpperCase()) {
    throw new GuideError("SAME_PLACE", "El punto de partida y el de llegada no pueden ser iguales.");
  }
  const today = new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 10);
  if (data.transferDate < today) throw new GuideError("TRANSFER_DATE", "La fecha de inicio del traslado no puede ser anterior a hoy.");
}

export async function getGuideById(tenantId: string, guideId: string) {
  const rows = await sql<GuideRow[]>`select * from despatch_guides where tenant_id = ${tenantId} and id = ${guideId} limit 1`;
  return rows[0] ? mapGuide(rows[0]) : null;
}

export async function listGuides(tenantId: string, limit = 100) {
  const rows = await sql<GuideRow[]>`
    select * from despatch_guides where tenant_id = ${tenantId}
    order by issue_date desc limit ${Math.min(Math.max(limit, 1), 200)}
  `;
  return rows.map(mapGuide);
}

/** Crea la guía y reserva su número. Idempotente por clientTransactionId. */
export async function prepareGuide(tenantId: string, input: {
  clientTransactionId: string;
  guideType: DespatchGuideType;
  data: DespatchData;
  relatedReceiptId?: string;
}) {
  const existing = await sql<GuideRow[]>`
    select * from despatch_guides where tenant_id = ${tenantId} and client_transaction_id = ${input.clientTransactionId} limit 1
  `;
  if (existing[0]) return { guide: mapGuide(existing[0]), created: false };

  assertGuideRules(input.guideType, input.data);
  const data: DespatchData = { ...input.data };
  if (input.relatedReceiptId) {
    const receipt = await getReceiptById(tenantId, input.relatedReceiptId);
    if (!receipt || (receipt.documentType !== "BOLETA" && receipt.documentType !== "FACTURA")) {
      throw new GuideError("RELATED_NOT_FOUND", "El comprobante relacionado no existe.");
    }
    data.relatedDocument = { documentType: receipt.documentType, series: receipt.series, correlative: receipt.correlative };
  }

  const practice = (await getTenantBillingConfig(tenantId)).providerCode === "mock";
  const series = seriesFor(input.guideType, practice);
  const documentType = input.guideType === "REMITENTE" ? "GUIA_REMITENTE" : "GUIA_TRANSPORTISTA";
  const id = randomUUID();
  try {
    await sql.begin(async (tx) => {
      await tx`
        insert into document_series (id, tenant_id, document_type, series, last_correlative)
        values (${randomUUID()}, ${tenantId}, ${documentType}, ${series}, 0)
        on conflict (tenant_id, document_type, series) do nothing
      `;
      const [sequence] = await tx<{ last_correlative: string }[]>`
        update document_series set last_correlative = last_correlative + 1, updated_at = now()
        where tenant_id = ${tenantId} and document_type = ${documentType} and series = ${series} and active = true
        returning last_correlative
      `;
      if (!sequence) throw new Error("No se pudo reservar el número de la guía");
      await tx`
        insert into despatch_guides (id, tenant_id, client_transaction_id, guide_type, series, correlative, transfer_date, data, related_receipt_id, is_practice)
        values (${id}, ${tenantId}, ${input.clientTransactionId}, ${input.guideType}, ${series}, ${Number(sequence.last_correlative)},
                ${data.transferDate}, ${sql.json(data as never)}, ${input.relatedReceiptId ?? null}, ${practice})
      `;
    });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      const concurrent = await sql<GuideRow[]>`select * from despatch_guides where tenant_id = ${tenantId} and client_transaction_id = ${input.clientTransactionId} limit 1`;
      if (concurrent[0]) return { guide: mapGuide(concurrent[0]), created: false };
    }
    throw error;
  }
  return { guide: (await getGuideById(tenantId, id))!, created: true };
}

export function guideCommand(guide: GuideRecord): DespatchCommand {
  return {
    tenantId: guide.tenantId,
    guideId: guide.id,
    guideType: guide.guideType,
    series: guide.series,
    correlative: guide.correlative,
    issueDate: guide.issueDate,
    data: guide.data,
    practice: guide.practice
  };
}

async function store(tenantId: string, guideId: string, result: DespatchResult) {
  const status: GuideStatus = result.status === "ACCEPTED" ? "ACEPTADO" : result.status === "REJECTED" ? "RECHAZADO" : "PENDIENTE";
  await sql`
    update despatch_guides
    set status = ${status}, ticket = coalesce(${result.ticket ?? null}, ticket), provider_code = ${result.providerCode},
        message = ${result.message},
        provider_pdf_url = coalesce(${result.pdfUrl ?? null}, provider_pdf_url),
        provider_xml_url = coalesce(${result.xmlUrl ?? null}, provider_xml_url),
        provider_cdr_url = coalesce(${result.cdrUrl ?? null}, provider_cdr_url),
        provider_hash = coalesce(${result.hash ?? null}, provider_hash),
        provider_qr_data = coalesce(${result.qrData ?? null}, provider_qr_data),
        updated_at = now()
    where tenant_id = ${tenantId} and id = ${guideId} and status not in ('ACEPTADO', 'RECHAZADO')
  `;
}

/**
 * Envía o consulta la guía. Con ticket o tras un intento previo: consulta
 * primero; solo reenvía si el proveedor no tiene registro y no hay ticket.
 */
export async function processGuide(billingService: BillingService, tenantId: string, guideId: string) {
  const guide = await getGuideById(tenantId, guideId);
  if (!guide) throw new GuideError("NOT_FOUND", "Guía no encontrada", 404);
  if (guide.status === "ACEPTADO" || guide.status === "RECHAZADO") return guide;
  const claimed = await sql<{ id: string }[]>`
    update despatch_guides
    set status = 'ENVIANDO', attempt_count = attempt_count + 1, last_attempt_at = now(), updated_at = now()
    where tenant_id = ${tenantId} and id = ${guideId}
      and (status in ('PENDIENTE', 'ERROR')
        or (status = 'ENVIANDO' and (last_attempt_at is null or last_attempt_at < now() - make_interval(secs => ${STALE_SENDING_SECONDS}))))
    returning id
  `;
  if (!claimed[0]) return (await getGuideById(tenantId, guideId))!;

  const command = guideCommand(guide);
  try {
    let result: DespatchResult;
    if (guide.ticket || guide.attemptCount > 0) {
      result = await billingService.despatchStatus(command, guide.ticket);
      if (result.status === "PENDING" && !guide.ticket && !result.ticket && guide.providerCode !== "nubefact") {
        result = await billingService.issueDespatch(command);
      }
    } else {
      result = await billingService.issueDespatch(command);
    }
    await store(tenantId, guideId, result);
  } catch (error) {
    await sql`
      update despatch_guides set status = 'ERROR', message = ${error instanceof Error ? error.message : "Error al enviar la guía"}, updated_at = now()
      where tenant_id = ${tenantId} and id = ${guideId} and status not in ('ACEPTADO', 'RECHAZADO')
    `;
  }
  return (await getGuideById(tenantId, guideId))!;
}

export async function processPendingGuides(billingService: BillingService, options: { limit?: number; maxAttempts?: number } = {}) {
  const rows = await sql<{ id: string; tenant_id: string }[]>`
    select id, tenant_id from despatch_guides
    where status in ('PENDIENTE', 'ENVIANDO', 'ERROR')
      and attempt_count < ${options.maxAttempts ?? Number(process.env.RECEIPT_MAX_ATTEMPTS ?? 12)}
      and (last_attempt_at is null or last_attempt_at < now() - make_interval(mins => least(60, power(2, greatest(attempt_count - 1, 0))::int)))
    order by last_attempt_at nulls first
    limit ${options.limit ?? 20}
  `;
  const processed: Array<{ id: string; status: string }> = [];
  for (const row of rows) {
    try {
      processed.push({ id: row.id, status: (await processGuide(billingService, row.tenant_id, row.id)).status });
    } catch (error) {
      processed.push({ id: row.id, status: `ERROR: ${error instanceof Error ? error.message : "desconocido"}` });
    }
  }
  return processed;
}

export function guideNumber(guide: Pick<GuideRecord, "series" | "correlative">) {
  return `${guide.series}-${String(guide.correlative).padStart(8, "0")}`;
}

export function guideToApi(guide: GuideRecord) {
  return {
    id: guide.id,
    clientTransactionId: guide.clientTransactionId,
    guideType: guide.guideType,
    series: guide.series,
    correlative: guide.correlative,
    number: guideNumber(guide),
    issueDate: guide.issueDate,
    transferDate: guide.transferDate,
    status: guide.status === "ACEPTADO" ? "ACCEPTED" : guide.status === "RECHAZADO" ? "REJECTED" : guide.status === "ERROR" ? "ERROR" : "PENDING",
    sunatStatus: guide.status,
    providerCode: guide.providerCode,
    ticket: guide.ticket,
    message: guide.message,
    practice: guide.practice,
    relatedReceiptId: guide.relatedReceiptId,
    data: guide.data
  };
}

const TYPE_LABEL = { REMITENTE: "GUIA DE REMISION REMITENTE", TRANSPORTISTA: "GUIA DE REMISION TRANSPORTISTA" } as const;

/** Representación interna (solo modo práctica, o si el proveedor no da PDF). */
export function renderGuidePdf(guide: GuideRecord, business: BusinessRecord) {
  const d = guide.data;
  const lines: PdfLine[] = [];
  lines.push({ text: business.tradeName ?? business.businessName ?? "Mi negocio", size: 15, bold: true, gap: 18 });
  if (business.ruc) lines.push({ text: `RUC: ${business.ruc}`, size: 9 });
  lines.push({ text: "", gap: 8 });
  lines.push({ text: `${TYPE_LABEL[guide.guideType]} ELECTRONICA`, size: 13, bold: true, gap: 16 });
  lines.push({ text: guideNumber(guide), size: 13, bold: true, gap: 16 });
  lines.push({ text: `Fecha de emision: ${guide.issueDate.slice(0, 10)}   Inicio de traslado: ${d.transferDate}`, size: 9 });
  if (d.reasonCode) lines.push({ text: `Motivo de traslado: ${d.reasonCode}${d.reasonDescription ? ` - ${d.reasonDescription}` : ""}`, size: 9 });
  lines.push({ text: `Peso bruto: ${d.grossWeight} ${d.weightUnit}${d.packages ? `   Bultos: ${d.packages}` : ""}`, size: 9 });
  lines.push({ text: "", gap: 8 });
  lines.push({ text: `DESTINATARIO: ${d.recipient.name} (${d.recipient.documentNumber})`, size: 9, bold: true });
  if (d.shipper) lines.push({ text: `REMITENTE: ${d.shipper.name} (${d.shipper.documentNumber})`, size: 9, bold: true });
  wrapText(`Partida: ${d.origin.address} (${d.origin.ubigeo})`).forEach((text) => lines.push({ text, size: 8 }));
  wrapText(`Llegada: ${d.destination.address} (${d.destination.ubigeo})`).forEach((text) => lines.push({ text, size: 8 }));
  if (d.carrier) lines.push({ text: `Transportista: ${d.carrier.name} (RUC ${d.carrier.documentNumber})`, size: 8 });
  if (d.vehiclePlate) lines.push({ text: `Vehiculo: ${d.vehiclePlate}`, size: 8 });
  if (d.driver) lines.push({ text: `Conductor: ${d.driver.names} ${d.driver.surnames} - Licencia ${d.driver.license}`, size: 8 });
  if (d.relatedDocument) lines.push({ text: `Comprobante relacionado: ${d.relatedDocument.series}-${d.relatedDocument.correlative}`, size: 8 });
  lines.push({ text: "", gap: 8 });
  lines.push({ text: "BIENES", size: 10, bold: true, gap: 13 });
  for (const item of d.items) {
    wrapText(`${item.quantity} ${item.unit}  ${item.description}`, 80).forEach((text) => lines.push({ text, size: 8 }));
  }
  lines.push({ text: "", gap: 8 });
  if (guide.practice || guide.providerCode === "mock") lines.push({ text: "ENTORNO DE PRUEBA - NO TIENE VALIDEZ TRIBUTARIA.", size: 8, bold: true });
  return renderLinesPdf(lines);
}
