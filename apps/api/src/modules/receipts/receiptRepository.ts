import { randomUUID } from "node:crypto";
import { sql } from "../../db/client.js";
import { upsertCustomer } from "../customers/customerRepository.js";
import { isNoteType } from "../billing/contracts.js";
import type {
  BillingDocumentType,
  BillingIssueResult,
  IssueDocumentCommand,
  PaymentMethod,
  SaleDocumentType
} from "../billing/contracts.js";
import { IGV_PERCENT, priceItems } from "./pricing.js";
import { getTenantBillingConfig } from "../billing/tenantBillingConfigRepository.js";
import { PRACTICE_SERIES } from "../billing/practiceMode.js";
import type { TransactionSql } from "postgres";

export type ReceiptStatus = "PENDIENTE" | "ENVIANDO" | "ACEPTADO" | "OBSERVADO" | "RECHAZADO" | "ERROR";

export type ReceiptItemInput = {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
  unit?: string;
};

export type ReceiptCustomer = {
  documentType?: "DNI" | "RUC";
  documentNumber?: string;
  name?: string;
  address?: string;
  phone?: string;
  email?: string;
};

export type ReceiptInput = {
  tenantId: string;
  clientTransactionId: string;
  temporaryNumber: string;
  documentType: BillingDocumentType;
  customer?: ReceiptCustomer;
  items: ReceiptItemInput[];
  total: number;
  paymentMethod?: PaymentMethod;
  /** Monto entregado por el cliente (solo efectivo), para calcular el vuelto. */
  amountReceived?: number;
  /** Solo notas de crédito/débito: comprobante que modifican. */
  relatedReceiptId?: string;
  relatedDocumentType?: SaleDocumentType;
  /** Motivo SUNAT (catálogo 09 / 10) y sustento de la nota. */
  noteReasonCode?: string;
  noteDescription?: string;
  /** Fuerza modo práctica (por defecto: si el negocio usa el simulador). */
  practice?: boolean;
  /**
   * Validación dentro de la misma transacción que reserva el correlativo (por
   * ejemplo, bloquear el comprobante original y verificar su saldo).
   */
  guard?: (tx: TransactionSql<Record<string, unknown>>) => Promise<void>;
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
  paymentMethod: PaymentMethod;
  amountReceived?: number;
  changeAmount?: number;
  relatedReceiptId?: string;
  noteReasonCode?: string;
  noteDescription?: string;
  practice: boolean;
  /** Nota de crédito que anula este comprobante completo (motivos 01/02/06), si existe. */
  creditNote?: { id: string; status: ReceiptStatus; officialNumber?: string };
  /** Suma de notas de crédito / débito no rechazadas que lo modifican. */
  creditedTotal: number;
  debitedTotal: number;
  /** Comunicación de baja / resumen de baja, si existe. */
  voiding?: { id: string; status: string; kind: string };
  providerCode?: string;
  providerDocumentId?: string;
  providerMessage?: string;
  pdfUrl?: string;
  xmlUrl?: string;
  cdrUrl?: string;
  qrData?: string;
  hash?: string;
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
  payment_method: PaymentMethod;
  amount_received: string | number | null;
  change_amount: string | number | null;
  related_receipt_id: string | null;
  credit_note_reason: string | null;
  note_reason_code: string | null;
  is_practice: boolean;
  credited_total: string | number | null;
  debited_total: string | number | null;
  voiding_id: string | null;
  voiding_status: string | null;
  voiding_kind: string | null;
  credit_note_id: string | null;
  credit_note_status: ReceiptStatus | null;
  credit_note_number: string | null;
  provider_code: string | null;
  provider_document_id: string | null;
  provider_message: string | null;
  provider_pdf_url: string | null;
  provider_xml_url: string | null;
  provider_cdr_url: string | null;
  provider_qr_data: string | null;
  provider_hash: string | null;
  attempt_count: number;
};

type ReceiptItemRow = {
  product_ref: string | null;
  description: string;
  quantity: string | number;
  unit_price: string | number;
  unit_code: string;
};

/** Columnas de un comprobante, incluida la nota de crédito que lo anula (si existe). */
const receiptColumns = sql`
  r.id, r.tenant_id, r.customer_id, r.client_transaction_id, r.temporary_number,
  r.document_type, r.series, r.correlative, r.official_number, r.issue_date,
  r.subtotal, r.igv, r.total, r.sunat_status,
  r.customer_document_type, r.customer_document_number, r.customer_name, r.customer_address,
  r.payment_method, r.amount_received, r.change_amount, r.related_receipt_id, r.credit_note_reason,
  r.note_reason_code, r.is_practice,
  nc.id as credit_note_id, nc.sunat_status as credit_note_status, nc.official_number as credit_note_number,
  notes.credited_total, notes.debited_total,
  rv.id as voiding_id, rv.status as voiding_status, rv.kind as voiding_kind,
  r.provider_code, r.provider_document_id, r.provider_message,
  r.provider_pdf_url, r.provider_xml_url, r.provider_cdr_url, r.provider_qr_data, r.provider_hash,
  r.attempt_count
`;
const receiptFrom = sql`
  receipts r
  left join lateral (
    -- La nota de crédito total vigente; si todas fueron rechazadas, la más reciente.
    select id, sunat_status, official_number
    from receipts
    where related_receipt_id = r.id and document_type = 'NOTA_CREDITO' and note_reason_code in ('01', '02', '06')
    order by (sunat_status = 'RECHAZADO'), created_at desc
    limit 1
  ) nc on true
  left join lateral (
    select
      coalesce(sum(total) filter (where document_type = 'NOTA_CREDITO'), 0) as credited_total,
      coalesce(sum(total) filter (where document_type = 'NOTA_DEBITO'), 0) as debited_total
    from receipts
    where related_receipt_id = r.id and sunat_status <> 'RECHAZADO'
  ) notes on true
  left join lateral (
    select id, status, kind from receipt_voidings
    where receipt_id = r.id
    order by (status = 'RECHAZADO'), created_at desc
    limit 1
  ) rv on true
`;

const optionalNumber = (value: string | number | null) => (value === null ? undefined : Number(value));

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
    paymentMethod: row.payment_method,
    amountReceived: optionalNumber(row.amount_received),
    changeAmount: optionalNumber(row.change_amount),
    relatedReceiptId: row.related_receipt_id ?? undefined,
    noteReasonCode: row.note_reason_code ?? undefined,
    noteDescription: row.credit_note_reason ?? undefined,
    practice: row.is_practice,
    creditedTotal: Number(row.credited_total ?? 0),
    debitedTotal: Number(row.debited_total ?? 0),
    voiding: row.voiding_id ? { id: row.voiding_id, status: row.voiding_status ?? "PENDIENTE", kind: row.voiding_kind ?? "COMUNICACION_BAJA" } : undefined,
    creditNote: row.credit_note_id
      ? { id: row.credit_note_id, status: row.credit_note_status ?? "PENDIENTE", officialNumber: row.credit_note_number ?? undefined }
      : undefined,
    providerCode: row.provider_code ?? undefined,
    providerDocumentId: row.provider_document_id ?? undefined,
    providerMessage: row.provider_message ?? undefined,
    pdfUrl: row.provider_pdf_url ?? undefined,
    xmlUrl: row.provider_xml_url ?? undefined,
    cdrUrl: row.provider_cdr_url ?? undefined,
    qrData: row.provider_qr_data ?? undefined,
    hash: row.provider_hash ?? undefined,
    attemptCount: row.attempt_count
  };
}

function defaultSeries(documentType: BillingDocumentType, relatedDocumentType?: SaleDocumentType, practice = false) {
  if (practice) return PRACTICE_SERIES[documentType];
  // Las notas usan serie F... para facturas y B... para boletas.
  if (documentType === "NOTA_CREDITO") {
    return relatedDocumentType === "FACTURA"
      ? process.env.DEFAULT_NC_FACTURA_SERIES ?? "FC01"
      : process.env.DEFAULT_NC_BOLETA_SERIES ?? "BC01";
  }
  if (documentType === "NOTA_DEBITO") {
    return relatedDocumentType === "FACTURA"
      ? process.env.DEFAULT_ND_FACTURA_SERIES ?? "FD01"
      : process.env.DEFAULT_ND_BOLETA_SERIES ?? "BD01";
  }
  return documentType === "BOLETA"
    ? process.env.DEFAULT_BOLETA_SERIES ?? "B001"
    : process.env.DEFAULT_FACTURA_SERIES ?? "F001";
}

export async function getReceiptByTransaction(tenantId: string, clientTransactionId: string): Promise<ReceiptRecord | null> {
  const rows = await sql<ReceiptRow[]>`
    select ${receiptColumns} from ${receiptFrom}
    where r.tenant_id = ${tenantId} and r.client_transaction_id = ${clientTransactionId}
    limit 1
  `;
  return rows[0] ? mapReceipt(rows[0]) : null;
}

export async function getReceiptById(tenantId: string, receiptId: string): Promise<ReceiptRecord | null> {
  const rows = await sql<ReceiptRow[]>`
    select ${receiptColumns} from ${receiptFrom}
    where r.tenant_id = ${tenantId} and r.id = ${receiptId}
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
    select ${receiptColumns} from ${receiptFrom}
    where r.tenant_id = ${tenantId}
    order by r.issue_date desc
    limit ${safeLimit}
  `;
  return rows.map(mapReceipt);
}

/** Comprobantes emitidos en un rango [from, to) — para cierre de caja y reportes. */
export async function listReceiptsBetween(tenantId: string, from: Date, to: Date): Promise<ReceiptRecord[]> {
  const rows = await sql<ReceiptRow[]>`
    select ${receiptColumns} from ${receiptFrom}
    where r.tenant_id = ${tenantId} and r.issue_date >= ${from} and r.issue_date < ${to}
    order by r.issue_date asc, r.series asc, r.correlative asc
  `;
  return rows.map(mapReceipt);
}

export async function prepareReceipt(input: ReceiptInput): Promise<{ receipt: ReceiptRecord; created: boolean }> {
  const existing = await getReceiptByTransaction(input.tenantId, input.clientTransactionId);
  if (existing) return { receipt: existing, created: false };

  let customerId: string | undefined;
  if (input.documentType !== "NOTA_CREDITO" && input.documentType !== "NOTA_DEBITO" && input.customer?.documentType && input.customer.documentNumber && input.customer.name) {
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
  const paymentMethod: PaymentMethod = input.paymentMethod ?? "EFECTIVO";
  const amountReceived = paymentMethod === "EFECTIVO" && input.amountReceived !== undefined ? input.amountReceived : undefined;
  const changeAmount = amountReceived !== undefined ? Math.round((amountReceived - total) * 100) / 100 : undefined;
  // Sin facturación activa (simulador) se usan series de práctica.
  const practice = input.practice ?? (await getTenantBillingConfig(input.tenantId)).providerCode === "mock";
  const series = defaultSeries(input.documentType, input.relatedDocumentType, practice);
  const receiptId = randomUUID();

  try {
    const createdId = await sql.begin(async (tx) => {
      const duplicate = await tx<{ id: string }[]>`
        select id from receipts
        where tenant_id = ${input.tenantId} and client_transaction_id = ${input.clientTransactionId}
        limit 1
      `;
      if (duplicate[0]) return duplicate[0].id;
      if (input.guard) await input.guard(tx);

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

      await tx`
        insert into receipts (
          id, tenant_id, customer_id, client_transaction_id, temporary_number,
          document_type, series, correlative, issue_date, currency,
          subtotal, igv, total, igv_rate, sunat_status,
          customer_document_type, customer_document_number, customer_name, customer_address,
          payment_method, amount_received, change_amount, related_receipt_id, credit_note_reason,
          note_reason_code, is_practice
        ) values (
          ${receiptId}, ${input.tenantId}, ${customerId ?? null}, ${input.clientTransactionId}, ${input.temporaryNumber},
          ${input.documentType}, ${series}, ${correlative}, now(), 'PEN',
          ${subtotal}, ${igv}, ${total}, ${IGV_PERCENT}, 'PENDIENTE',
          ${input.customer?.documentType ?? null}, ${input.customer?.documentNumber ?? null},
          ${input.customer?.name ?? null}, ${input.customer?.address ?? null},
          ${paymentMethod}, ${amountReceived ?? null}, ${changeAmount ?? null},
          ${input.relatedReceiptId ?? null}, ${input.noteDescription ?? null},
          ${input.noteReasonCode ?? null}, ${practice}
        )
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

      return receiptId;
    });

    const stored = await getReceiptById(input.tenantId, createdId);
    if (!stored) throw new Error("No pudimos recuperar el comprobante preparado.");
    return { receipt: stored, created: createdId === receiptId };
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
  const rows = await sql<{ id: string }[]>`
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
  await sql`
    update receipts
    set sunat_status = 'ERROR', provider_message = ${message}, updated_at = now()
    where tenant_id = ${tenantId} and id = ${receiptId}
      and sunat_status not in ('ACEPTADO', 'RECHAZADO')
  `;
  const current = await getReceiptById(tenantId, receiptId);
  if (!current) throw new Error("Comprobante no encontrado");
  return current;
}

export async function applyBillingResult(tenantId: string, receiptId: string, result: BillingIssueResult): Promise<ReceiptRecord> {
  const status: ReceiptStatus = result.status === "ACCEPTED" ? "ACEPTADO" : result.status === "REJECTED" ? "RECHAZADO" : "PENDIENTE";
  const updated = await sql<{ id: string }[]>`
    update receipts
    set
      sunat_status = ${status},
      official_number = coalesce(${result.officialNumber ?? null}, official_number),
      provider_code = ${result.providerCode},
      provider_document_id = coalesce(${result.providerDocumentId ?? null}, provider_document_id),
      provider_message = ${result.message},
      provider_pdf_url = coalesce(${result.pdfUrl ?? null}, provider_pdf_url),
      provider_xml_url = coalesce(${result.xmlUrl ?? null}, provider_xml_url),
      provider_cdr_url = coalesce(${result.cdrUrl ?? null}, provider_cdr_url),
      provider_qr_data = coalesce(${result.artifacts?.qrData ?? null}, provider_qr_data),
      provider_hash = coalesce(${result.artifacts?.hash ?? null}, provider_hash),
      updated_at = now()
    where tenant_id = ${tenantId} and id = ${receiptId}
      -- Un estado final (aceptado/rechazado) nunca vuelve a pendiente por una
      -- respuesta tardía o una conciliación concurrente.
      and sunat_status not in ('ACEPTADO', 'RECHAZADO')
    returning id
  `;

  if (updated[0] && result.artifacts) {
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

  const current = await getReceiptById(tenantId, receiptId);
  if (!current) throw new Error("Comprobante no encontrado");
  return current;
}

export async function buildBillingCommand(receipt: ReceiptRecord): Promise<IssueDocumentCommand> {
  const items = receipt.items ?? await getReceiptItems(receipt.id);
  let relatedDocument: IssueDocumentCommand["relatedDocument"];
  if (isNoteType(receipt.documentType) && receipt.relatedReceiptId) {
    const related = await getReceiptById(receipt.tenantId, receipt.relatedReceiptId);
    if (!related || isNoteType(related.documentType)) throw new Error("No encontramos el comprobante que modifica esta nota.");
    relatedDocument = { documentType: related.documentType, series: related.series, correlative: related.correlative };
  }
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
    total: receipt.total,
    paymentMethod: receipt.paymentMethod,
    relatedDocument,
    noteReason: isNoteType(receipt.documentType)
      ? { code: receipt.noteReasonCode ?? "01", description: receipt.noteDescription || "ANULACION DE LA OPERACION" }
      : undefined,
    practice: receipt.practice
  };
}

export function displayNumber(receipt: Pick<ReceiptRecord, "officialNumber" | "series" | "correlative">) {
  return receipt.officialNumber ?? `${receipt.series}-${String(receipt.correlative).padStart(8, "0")}`;
}

function apiStatus(status: ReceiptStatus) {
  return status === "ACEPTADO" ? "ACCEPTED"
    : status === "RECHAZADO" ? "REJECTED"
    : status === "ERROR" ? "ERROR"
    : "PENDING";
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
    status: apiStatus(receipt.status),
    sunatStatus: receipt.status,
    customer: receipt.customer,
    paymentMethod: receipt.paymentMethod,
    amountReceived: receipt.amountReceived,
    changeAmount: receipt.changeAmount,
    relatedReceiptId: receipt.relatedReceiptId,
    noteReasonCode: receipt.noteReasonCode,
    noteDescription: receipt.noteDescription,
    /** Compatibilidad con versiones anteriores de la app. */
    creditNoteReason: receipt.noteDescription,
    practice: receipt.practice,
    /** true cuando una nota de crédito total o una baja aceptada anuló este comprobante. */
    voided: receipt.creditNote?.status === "ACEPTADO" || receipt.voiding?.status === "ACEPTADO",
    creditedTotal: receipt.creditedTotal,
    debitedTotal: receipt.debitedTotal,
    /** Saldo que aún puede acreditarse con notas de crédito. */
    creditableBalance: Math.max(0, Math.round((receipt.total + receipt.debitedTotal - receipt.creditedTotal) * 100) / 100),
    voiding: receipt.voiding,
    creditNote: receipt.creditNote
      ? { id: receipt.creditNote.id, status: apiStatus(receipt.creditNote.status), officialNumber: receipt.creditNote.officialNumber }
      : undefined,
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
