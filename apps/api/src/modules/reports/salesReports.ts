import { createHmac, timingSafeEqual } from "node:crypto";
import { PAYMENT_METHODS, type PaymentMethod } from "../billing/contracts.js";
import { displayNumber, listReceiptsBetween, type ReceiptRecord } from "../receipts/receiptRepository.js";
import { isPracticeSeries } from "../billing/practiceMode.js";

/** Perú no usa horario de verano: Lima es siempre UTC-5. */
const LIMA_OFFSET_HOURS = 5;

export function limaToday(now = new Date()) {
  const lima = new Date(now.getTime() - LIMA_OFFSET_HOURS * 3600_000);
  return lima.toISOString().slice(0, 10);
}

function limaDayRange(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const from = new Date(Date.UTC(year, month - 1, day, LIMA_OFFSET_HOURS));
  const to = new Date(from.getTime() + 24 * 3600_000);
  return { from, to };
}

function limaMonthRange(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const from = new Date(Date.UTC(year, monthNumber - 1, 1, LIMA_OFFSET_HOURS));
  const to = new Date(Date.UTC(year, monthNumber, 1, LIMA_OFFSET_HOURS));
  return { from, to };
}

const cents = (value: number) => Math.round(value * 100);
const fromCents = (value: number) => value / 100;

type Bucket = { count: number; totalCents: number };
const emptyBucket = (): Bucket => ({ count: 0, totalCents: 0 });
const add = (bucket: Bucket, receipt: ReceiptRecord) => {
  bucket.count += 1;
  bucket.totalCents += cents(receipt.total);
};
const view = (bucket: Bucket) => ({ count: bucket.count, total: fromCents(bucket.totalCents) });

/**
 * Cierre de caja del día (hora de Lima).
 *
 * - "Ventas" cuenta boletas y facturas no rechazadas: el dinero ya se cobró
 *   aunque SUNAT aún no confirme. Las pendientes se muestran aparte.
 * - Las notas de crédito del día (anulaciones) se restan por medio de pago:
 *   es dinero devuelto al cliente.
 */
export async function dailyClose(tenantId: string, date = limaToday()) {
  const { from, to } = limaDayRange(date);
  const receipts = await listReceiptsBetween(tenantId, from, to);

  const sales = emptyBucket();
  const accepted = emptyBucket();
  const pending = emptyBucket();
  const rejected = emptyBucket();
  const creditNotes = emptyBucket();
  const byMethod = new Map<PaymentMethod, { sales: Bucket; refunds: Bucket }>(
    PAYMENT_METHODS.map((method) => [method, { sales: emptyBucket(), refunds: emptyBucket() }])
  );
  const byDocumentType = { BOLETA: emptyBucket(), FACTURA: emptyBucket() };

  for (const receipt of receipts) {
    const method = byMethod.get(receipt.paymentMethod) ?? byMethod.get("EFECTIVO")!;
    if (receipt.documentType === "NOTA_CREDITO") {
      if (receipt.status === "RECHAZADO") continue;
      add(creditNotes, receipt);
      add(method.refunds, receipt);
      continue;
    }
    if (receipt.status === "RECHAZADO") {
      add(rejected, receipt);
      continue;
    }
    add(sales, receipt);
    add(byDocumentType[receipt.documentType], receipt);
    add(method.sales, receipt);
    if (receipt.status === "ACEPTADO") add(accepted, receipt);
    else add(pending, receipt);
  }

  const paymentMethods = [...byMethod.entries()]
    .map(([method, data]) => ({
      method,
      salesCount: data.sales.count,
      sales: fromCents(data.sales.totalCents),
      refunds: fromCents(data.refunds.totalCents),
      net: fromCents(data.sales.totalCents - data.refunds.totalCents)
    }))
    .filter((row) => row.salesCount > 0 || row.refunds > 0);

  return {
    date,
    sales: view(sales),
    accepted: view(accepted),
    pending: view(pending),
    rejected: view(rejected),
    creditNotes: view(creditNotes),
    netTotal: fromCents(sales.totalCents - creditNotes.totalCents),
    /** Efectivo que debería haber en caja por ventas del día (sin fondo inicial). */
    expectedCash: paymentMethods.find((row) => row.method === "EFECTIVO")?.net ?? 0,
    byDocumentType: { BOLETA: view(byDocumentType.BOLETA), FACTURA: view(byDocumentType.FACTURA) },
    paymentMethods
  };
}

const SUNAT_TYPE = { FACTURA: "01", BOLETA: "03", NOTA_CREDITO: "07" } as const;
const SUNAT_ID_TYPE = { DNI: "1", RUC: "6" } as const;

function csvCell(value: string | number | undefined | null) {
  const text = value === undefined || value === null ? "" : String(value);
  // Evita inyección de fórmulas al abrir el archivo en Excel.
  const safe = /^[=+\-@]/.test(text) && !/^-?\d/.test(text) ? `'${text}` : text;
  return /[",\n;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function limaDateTime(iso: string) {
  const lima = new Date(new Date(iso).getTime() - LIMA_OFFSET_HOURS * 3600_000).toISOString();
  return { date: lima.slice(0, 10).split("-").reverse().join("/"), time: lima.slice(11, 19) };
}

/**
 * Registro de ventas del mes en CSV (UTF-8 con BOM para que Excel respete
 * tildes). Las notas de crédito van con importes negativos y referencia al
 * comprobante que modifican, como las espera el contador.
 */
export async function salesRegisterCsv(tenantId: string, month: string) {
  const { from, to } = limaMonthRange(month);
  // Las ventas de práctica no son operaciones tributarias: no van al contador.
  const receipts = (await listReceiptsBetween(tenantId, from, to)).filter((receipt) => !isPracticeSeries(receipt.series));
  const byId = new Map(receipts.map((receipt) => [receipt.id, receipt]));

  const header = [
    "Fecha", "Hora", "Tipo CP", "Serie", "Número", "Tipo doc. cliente", "Nro. doc. cliente", "Cliente",
    "Base imponible", "IGV", "Total", "Medio de pago", "Estado SUNAT", "Anulado", "Doc. modificado"
  ];
  const lines = [header.map(csvCell).join(",")];

  for (const receipt of receipts) {
    const sign = receipt.documentType === "NOTA_CREDITO" ? -1 : 1;
    const { date, time } = limaDateTime(receipt.issueDate);
    const related = receipt.relatedReceiptId ? byId.get(receipt.relatedReceiptId) : undefined;
    lines.push([
      date,
      time,
      SUNAT_TYPE[receipt.documentType],
      receipt.series,
      receipt.correlative,
      receipt.customer?.documentType ? SUNAT_ID_TYPE[receipt.customer.documentType] : "0",
      receipt.customer?.documentNumber ?? "",
      receipt.customer?.name ?? "CLIENTES VARIOS",
      (sign * receipt.subtotal).toFixed(2),
      (sign * receipt.igv).toFixed(2),
      (sign * receipt.total).toFixed(2),
      receipt.paymentMethod,
      receipt.status,
      receipt.creditNote?.status === "ACEPTADO" ? "SI" : "NO",
      related ? displayNumber(related) : receipt.relatedReceiptId ? "(otro mes)" : ""
    ].map(csvCell).join(","));
  }

  return `﻿${lines.join("\r\n")}\r\n`;
}

// ---------- Enlace temporal de descarga ----------

function exportSecret() {
  const configured = process.env.PUBLIC_RECEIPT_LINK_SECRET?.trim();
  if (configured) return `report-export:${configured}`;
  if (process.env.NODE_ENV === "production") throw new Error("PUBLIC_RECEIPT_LINK_SECRET es obligatorio en producción");
  return "report-export:dev-public-receipt-link-secret-change-me";
}

/** Enlace firmado de 10 minutos para descargar el CSV desde el navegador o la app. */
export function createExportToken(tenantId: string, month: string, ttlSeconds = 600) {
  const payload = Buffer.from(JSON.stringify({ tenantId, month, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString("base64url");
  const signature = createHmac("sha256", exportSecret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyExportToken(token: string): { tenantId: string; month: string } {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) throw new Error("Enlace inválido");
  const expected = Buffer.from(createHmac("sha256", exportSecret()).update(payload).digest("base64url"));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error("Enlace inválido");
  const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { tenantId?: string; month?: string; exp?: number };
  if (!data.tenantId || !data.month || !data.exp) throw new Error("Enlace inválido");
  if (data.exp <= Math.floor(Date.now() / 1000)) throw new Error("Este enlace venció");
  return { tenantId: data.tenantId, month: data.month };
}
