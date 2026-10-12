import { randomUUID } from "node:crypto";
import { sql } from "../../db/client.js";
import { upsertCustomer } from "../customers/customerRepository.js";
import type { BillingDocumentType, BillingIssueResult, IssueDocumentCommand } from "../billing/contracts.js";
import { IGV_PERCENT, priceItems } from "./pricing.js";

export type ReceiptStatus = "PENDIENTE" | "ENVIANDO" | "ACEPTADO" | "OBSERVADO" | "RECHAZADO" | "ERROR";

export type ReceiptItemInput = {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
  unit?: string;
};

export type ReceiptInput = {
  tenantId: string;
  clientTransactionId: string;
  temporaryNumber: string;
  documentType: BillingDocumentType;
  customer?: {
    documentType?: "DNI" | "RUC";
    documentNumber?: string;
    name?: string;
    address?: string;
    phone?: string;
    email?: string;
  };
  items: ReceiptItemInput[];
  total: number;
};

export type ReceiptRecord = {
  id: string;
  tenantId: string;
  clientTransactionId: string;
  temporaryNumber: string;
  documentType: BillingDocumentType;
  series: string;
  correlative: number;
  officialNumber?: string;
  issueDate: string;
  subtotal: number;
  igv: number;
  total: number;
  status: ReceiptStatus;
  customerId?: string;
  customer?: {
    documentType?: "DNI" | "RUC";
    documentNumber?: string;
    name?: string;
    address?: string;
  };
  providerCode?: string;
  providerDocumentId?: string;
  providerMessage?: string;
  pdfUrl?: string;
  xmlUrl?: string;
  cdrUrl?: string;
  attemptCount: number;
  items?: ReceiptItemInput[];
};

type ReceiptRow = {
  id: string;
  tenant_id: string;
  customer_id: string | null;
  client_transaction_id: string;
  temporary_number: string;
  document_type: BillingDocumentType;
  series: string;
  correlative: string | number;
  official_number: string | null;
  issue_date: Date | string;
  subtotal: string | number;
  igv: string | number;
  total: string | number;
  sunat_status: ReceiptStatus;
  customer_document_type: "DNI" | "RUC" | null;
  customer_document_number: string | null;
  customer_name: string | null;
  customer_address: string | null;
  provider_code: string | null;
  provider_document_id: string | null;
  provider_message: string | null;
  provider_pdf_url: string | null;
  provider_xml_url: string | null;
  provider_cdr_url: string | null;
  attempt_count: number;
};

type ReceiptItemRow = {
  product_ref: string | null;
  description: string;
  quantity: string | number;
  unit_price: string | number;
  unit_code: string;
};

function defaultSeries(documentType: BillingDocumentType) {
  return documentType === "BOLETA"
    ? process.env.DEFAULT_BOLETA_SERIES ?? "B001"
    : process.env.DEFAULT_FACTURA_SERIES ?? "F001";
}

function mapReceipt(row: ReceiptRow): ReceiptRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clientTransactionId: row.client_transaction_id,
    temporaryNumber: row.temporary_number,
    documentType: row.document_type,
    series: row.series,
    correlative: Number(row.correlative),
    officialNumber: row.official_number ?? undefined,
    issueDate: new Date(row.issue_date).toISOString(),
    subtotal: Number(row.subtotal),
    igv: Number(row.igv),
    total: Number(row.total),
    status: row.sunat_status,
    customerId: row.customer_id ?? undefined,
    customer: row.customer_name || row.customer_document_number ? {
      documentType: row.customer_document_type ?? undefined,
      documentNumber: row.customer_document_number ?? undefined,
      name: row.customer_name ?? undefined,
      address: row.customer_address ?? undefined
    } : undefined,
    providerCode: row.provider_code ?? undefined,
    providerDocumentId: row.provider_document_id ?? undefined,
    providerMessage: row.provider_message ?? undefined,
    pdfUrl: row.provider_pdf_url ?? undefined,
    xmlUrl: row.provider_xml_url ?? undefined,
    cdrUrl: row.provider_cdr_url ?? undefined,
    attemptCount: row.attempt_count
  };
}

const receiptSelect = `
  id, tenant_id, customer_id, client_transaction_id, temporary_number,
  document_type, series, correlative, official_number, issue_date,
  subtotal, igv, total, sunat_status,
  customer_document_type, customer_document_number, customer_name, customer_address,
  provider_code, provider_document_id, provider_message,
  provider_pdf_url, provider_xml_url, provider_cdr_url, attempt_count
`;

export async function getReceiptByTransaction(tenantId: string, clientTransactionId: string): Promise<ReceiptRecord | null> {
  const rows = await sql<ReceiptRow[]>`
    select id, tenant_id, customer_id, client_transaction_id, temporary_number,
      document_type, series, correlative, official_number, issue_date,
      subtotal, igv, total, sunat_status,
      customer_document_type, customer_document_number, customer_name, customer_address,
      provider_code, provider_document_id, provider_message,
      provider_pdf_url, provider_xml_url, provider_cdr_url, attempt_count
    from receipts
    where tenant_id = ${tenantId} and client_transaction_id = ${clientTransactionId}
    limit 1
  `;
  return rows[0] ? mapReceipt(rows[0]) : null;
}

export async function getReceiptById(tenantId: string, receiptId: string): Promise<ReceiptRecord | null> {
  const rows = await sql<ReceiptRow[]>`
    select id, tenant_id, customer_id, client_transaction_id, temporary_number,
      document_type, series, correlative, official_number, issue_date,
      subtotal, igv, total, sunat_status,
      customer_document_type, customer_document_number, customer_name, customer_address,
      provider_code, provider_document_id, provider_message,
      provider_pdf_url, provider_xml_url, provider_cdr_url, attempt_count
    from receipts
    where tenant_id = ${tenantId} and id = ${receiptId}
    limit 1
  `;
  if (!rows[0]) return null;
  const receipt = mapReceipt(rows[0]);
  receipt.items = await getReceiptItems(receipt.id);
  return receipt;
}

async function getReceiptItems(receiptId: string): Promise<ReceiptItemInput[]> {
  const rows = await sql<ReceiptItemRow[]>`
    select product_ref, description, quantity, unit_price, unit_code
    from receipt_items
    where receipt_id = ${receiptId}
    order by created_at asc, id asc
  `;
  return rows.map((row) => ({
    id: row.product_ref ?? randomUUID(),
    name: row.description,
    quantity: Number(row.quantity),
    unitPrice: Number(row.unit_price),
    unit: row.unit_code
  }));
}

export async function listReceipts(tenantId: string, limit = 100): Promise<ReceiptRecord[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 200);
  const rows = await sql<ReceiptRow[]>`
    select id, tenant_id, customer_id, client_transaction_id, temporary_number,
      document_type, series, correlative, official_number, issue_date,
      subtotal, igv, total, sunat_status,
      customer_document_type, customer_document_number, customer_name, customer_address,
      provider_code, provider_document_id, provider_message,
      provider_pdf_url, provider_xml_url, provider_cdr_url, attempt_count
    from receipts
    where tenant_id = ${tenantId}
    order by issue_date desc
    limit ${safeLimit}
  `;
  return rows.map(mapReceipt);
}

export async function prepareReceipt(input: ReceiptInput): Promise<{ receipt: ReceiptRecord; created: boolean }> {
  const existing = await getReceiptByTransaction(input.tenantId, input.clientTransactionId);
  if (existing) return { receipt: existing, created: false };

  let customerId: string | undefined;
  if (input.customer?.documentType && input.customer.documentNumber && input.customer.name) {
    const customer = await upsertCustomer({
      tenantId: input.tenantId,
      documentType: input.customer.documentType,
      documentNumber: input.customer.documentNumber,
      fullName: input.customer.name,
      address: input.customer.address,
      phone: input.customer.phone,
      email: input.customer.email,
      dataSource: "MANUAL"
    });
    customerId = customer.id;
  }

  // Los montos se recalculan siempre en el servidor a partir de los ítems.
  const priced = priceItems(input.items);
  const { subtotal, igv, total } = priced;
  const series = defaultSeries(input.documentType);
  const receiptId = randomUUID();

  try {
    const row = await sql.begin(async (tx) => {
      const duplicate = await tx<ReceiptRow[]>`
        select id, tenant_id, customer_id, client_transaction_id, temporary_number,
          document_type, series, correlative, official_number, issue_date,
          subtotal, igv, total, sunat_status,
          customer_document_type, customer_document_number, customer_name, customer_address,
          provider_code, provider_document_id, provider_message,
          provider_pdf_url, provider_xml_url, provider_cdr_url, attempt_count
        from receipts
        where tenant_id = ${input.tenantId} and client_transaction_id = ${input.clientTransactionId}
        limit 1
      `;
      if (duplicate[0]) return duplicate[0];

      await tx`
        insert into document_series (id, tenant_id, document_type, series, last_correlative)
        values (${randomUUID()}, ${input.tenantId}, ${input.documentType}, ${series}, 0)
        on conflict (tenant_id, document_type, series) do nothing
      `;

      const sequence = await tx<{ last_correlative: string | number }[]>`
        update document_series
        set last_correlative = last_correlative + 1, updated_at = now()
        where tenant_id = ${input.tenantId}
          and document_type = ${input.documentType}
          and series = ${series}
          and active = true
        returning last_correlative
      `;
      if (!sequence[0]) throw new Error("No se pudo reservar el correlativo del comprobante");
      const correlative = Number(sequence[0].last_correlative);

      const inserted = await tx<ReceiptRow[]>`
        insert into receipts (
          id, tenant_id, customer_id, client_transaction_id, temporary_number,
          document_type, series, correlative, issue_date, currency,
          subtotal, igv, total, igv_rate, sunat_status,
          customer_document_type, customer_document_number, customer_name, customer_address
        ) values (
          ${receiptId}, ${input.tenantId}, ${customerId ?? null}, ${input.clientTransactionId}, ${input.temporaryNumber},
          ${input.documentType}, ${series}, ${correlative}, now(), 'PEN',
          ${subtotal}, ${igv}, ${total}, ${IGV_PERCENT}, 'PENDIENTE',
          ${input.customer?.documentType ?? null}, ${input.customer?.documentNumber ?? null},
          ${input.customer?.name ?? null}, ${input.customer?.address ?? null}
        )
        returning id, tenant_id, customer_id, client_transaction_id, temporary_number,
          document_type, series, correlative, official_number, issue_date,
          subtotal, igv, total, sunat_status,
          customer_document_type, customer_document_number, customer_name, customer_address,
          provider_code, provider_document_id, provider_message,
          provider_pdf_url, provider_xml_url, provider_cdr_url, attempt_count
      `;

      for (const [index, item] of input.items.entries()) {
        const line = priced.lines[index];
        await tx`
          insert into receipt_items (
            id, receipt_id, product_ref, description, quantity, unit_code,
            unit_price, line_subtotal, line_igv, line_total, igv_rate
          ) values (
            ${randomUUID()}, ${receiptId}, ${item.id}, ${item.name}, ${line.quantity}, ${item.unit ?? "NIU"},
            ${line.unitPrice}, ${line.lineSubtotal}, ${line.lineIgv}, ${line.lineTotal}, ${IGV_PERCENT}
          )
        `;
      }

      return inserted[0];
    });

    const mapped = mapReceipt(row);
    mapped.items = input.items;
    return { receipt: mapped, created: row.id === receiptId };
  } catch (error) {
    const pgError = error as { code?: string };
    if (pgError.code === "23505") {
      const duplicate = await getReceiptByTransaction(input.tenantId, input.clientTransactionId);
      if (duplicate) return { receipt: duplicate, created: false };
    }
    throw error;
  }
}

const FINAL_STATUSES: ReceiptStatus[] = ["ACEPTADO", "RECHAZADO"];

export function isFinalStatus(status: ReceiptStatus) {
  return FINAL_STATUSES.includes(status);
}

/** Segundos tras los cuales un envío ENVIANDO se considera abandonado (proceso caído). */
const STALE_SENDING_SECONDS = Number(process.env.RECEIPT_STALE_SENDING_SECONDS ?? 120);

/**
 * Reserva atómicamente el derecho a enviar el comprobante al proveedor.
 * Solo una petición a la vez puede pasar a ENVIANDO; las demás reciben null
 * y deben responder con el estado actual en vez de enviar en paralelo.
 */
export async function claimReceiptForSending(tenantId: string, receiptId: string): Promise<ReceiptRecord | null> {
  const rows = await sql<ReceiptRow[]>`
    update receipts
    set sunat_status = 'ENVIANDO', attempt_count = attempt_count + 1, last_attempt_at = now(), updated_at = now()
    where tenant_id = ${tenantId} and id = ${receiptId}
      and (
        sunat_status in ('PENDIENTE', 'ERROR', 'OBSERVADO')
        or (sunat_status = 'ENVIANDO' and (last_attempt_at is null or last_attempt_at < now() - make_interval(secs => ${STALE_SENDING_SECONDS})))
      )
    returning id
  `;
  if (!rows[0]) return null;
  return getReceiptById(tenantId, receiptId);
}

export async function markReceiptError(tenantId: string, receiptId: string, message: string): Promise<ReceiptRecord> {
  const rows = await sql<ReceiptRow[]>`
    update receipts
    set sunat_status = 'ERROR', provider_message = ${message}, updated_at = now()
    where tenant_id = ${tenantId} and id = ${receiptId}
      and sunat_status not in ('ACEPTADO', 'RECHAZADO')
    returning id, tenant_id, customer_id, client_transaction_id, temporary_number,
      document_type, series, correlative, official_number, issue_date,
      subtotal, igv, total, sunat_status,
      customer_document_type, customer_document_number, customer_name, customer_address,
      provider_code, provider_document_id, provider_message,
      provider_pdf_url, provider_xml_url, provider_cdr_url, attempt_count
  `;
  if (!rows[0]) {
    const current = await getReceiptById(tenantId, receiptId);
    if (!current) throw new Error("Comprobante no encontrado");
    return current;
  }
  return mapReceipt(rows[0]);
}

export async function applyBillingResult(tenantId: string, receiptId: string, result: BillingIssueResult): Promise<ReceiptRecord> {
  const status: ReceiptStatus = result.status === "ACCEPTED" ? "ACEPTADO" : result.status === "REJECTED" ? "RECHAZADO" : "PENDIENTE";
  const rows = await sql<ReceiptRow[]>`
    update receipts
    set
      sunat_status = ${status},
      official_number = coalesce(${result.officialNumber ?? null}, official_number),
      provider_code = ${result.providerCode},
      provider_document_id = ${result.providerDocumentId ?? null},
      provider_message = ${result.message},
      provider_pdf_url = ${result.pdfUrl ?? null},
      provider_xml_url = ${result.xmlUrl ?? null},
      provider_cdr_url = ${result.cdrUrl ?? null},
      updated_at = now()
    where tenant_id = ${tenantId} and id = ${receiptId}
      -- Un estado final (aceptado/rechazado) nunca vuelve a pendiente por una
      -- respuesta tardía o una conciliación concurrente.
      and sunat_status not in ('ACEPTADO', 'RECHAZADO')
    returning id, tenant_id, customer_id, client_transaction_id, temporary_number,
      document_type, series, correlative, official_number, issue_date,
      subtotal, igv, total, sunat_status,
      customer_document_type, customer_document_number, customer_name, customer_address,
      provider_code, provider_document_id, provider_message,
      provider_pdf_url, provider_xml_url, provider_cdr_url, attempt_count
  `;

  if (!rows[0]) {
    const current = await getReceiptById(tenantId, receiptId);
    if (!current) throw new Error("Comprobante no encontrado");
    return current;
  }

  if (result.artifacts) {
    await sql`
      insert into receipt_provider_artifacts (
        receipt_id, provider_code, provider_hash, xml_content, cdr_zip_base64, raw_response, updated_at
      ) values (
        ${receiptId}, ${result.providerCode}, ${result.artifacts.hash ?? null},
        ${result.artifacts.xmlContent ?? null}, ${result.artifacts.cdrZipBase64 ?? null},
        ${result.artifacts.rawResponse ? sql.json(result.artifacts.rawResponse as never) : null}, now()
      )
      on conflict (receipt_id) do update set
        provider_code = excluded.provider_code,
        provider_hash = coalesce(excluded.provider_hash, receipt_provider_artifacts.provider_hash),
        xml_content = coalesce(excluded.xml_content, receipt_provider_artifacts.xml_content),
        cdr_zip_base64 = coalesce(excluded.cdr_zip_base64, receipt_provider_artifacts.cdr_zip_base64),
        raw_response = coalesce(excluded.raw_response, receipt_provider_artifacts.raw_response),
        updated_at = now()
    `;
  }

  const stored = mapReceipt(rows[0]);
  stored.items = await getReceiptItems(receiptId);
  return stored;
}

export async function buildBillingCommand(receipt: ReceiptRecord): Promise<IssueDocumentCommand> {
  const items = receipt.items ?? await getReceiptItems(receipt.id);
  return {
    tenantId: receipt.tenantId,
    clientTransactionId: receipt.clientTransactionId,
    documentType: receipt.documentType,
    series: receipt.series,
    correlative: receipt.correlative,
    currency: "PEN",
    issueDate: receipt.issueDate,
    customer: receipt.customer,
    items: items.map((item) => ({
      sku: item.id,
      description: item.name,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      unitCode: item.unit
    })),
    subtotal: receipt.subtotal,
    igv: receipt.igv,
    total: receipt.total
  };
}

export function receiptToApi(receipt: ReceiptRecord) {
  return {
    id: receipt.id,
    clientTransactionId: receipt.clientTransactionId,
    temporaryNumber: receipt.temporaryNumber,
    documentType: receipt.documentType,
    series: receipt.series,
    correlative: receipt.correlative,
    officialNumber: receipt.officialNumber,
    issueDate: receipt.issueDate,
    subtotal: receipt.subtotal,
    igv: receipt.igv,
    total: receipt.total,
    status: receipt.status === "ACEPTADO" ? "ACCEPTED"
      : receipt.status === "RECHAZADO" ? "REJECTED"
      : receipt.status === "ERROR" ? "ERROR"
      : "PENDING",
    sunatStatus: receipt.status,
    customer: receipt.customer,
    providerCode: receipt.providerCode,
    providerDocumentId: receipt.providerDocumentId,
    message: receipt.providerMessage,
    pdfUrl: receipt.pdfUrl,
    xmlUrl: receipt.xmlUrl,
    cdrUrl: receipt.cdrUrl,
    attemptCount: receipt.attemptCount,
    items: receipt.items
  };
}
