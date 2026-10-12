import { createReceiptLinkToken, publicBaseUrl, receiptLinkTtlSeconds } from "./publicReceiptLinks.js";
import type { ReceiptRecord } from "../receipts/receiptRepository.js";
import type { BusinessRecord } from "../tenants/tenantRepository.js";
import type { BillingDocumentType } from "../billing/contracts.js";

export type ReceiptSharePackage = {
  documentType: BillingDocumentType;
  documentNumber: string;
  total: number;
  viewUrl: string;
  pdfUrl: string;
  whatsappText: string;
  emailSubject: string;
  emailBody: string;
  expiresAt: string;
};

export const DOCUMENT_LABEL: Record<BillingDocumentType, string> = {
  BOLETA: "boleta electrónica",
  FACTURA: "factura electrónica",
  NOTA_CREDITO: "nota de crédito electrónica"
};

function businessName(business: BusinessRecord) {
  return business.tradeName ?? business.businessName ?? "Tu comercio";
}

export function createReceiptSharePackage(receipt: ReceiptRecord, business: BusinessRecord): ReceiptSharePackage {
  if (receipt.status !== "ACEPTADO") throw new Error("El comprobante todavía no está aceptado.");
  const expiresAt = new Date(Date.now() + receiptLinkTtlSeconds() * 1000);
  const view = createReceiptLinkToken({ receiptId: receipt.id, tenantId: receipt.tenantId, purpose: "VIEW", expiresAt });
  const pdf = createReceiptLinkToken({ receiptId: receipt.id, tenantId: receipt.tenantId, purpose: "PDF", expiresAt });
  const base = publicBaseUrl();
  const viewUrl = `${base}/r?t=${encodeURIComponent(view.token)}`;
  // La representación impresa oficial (con QR y hash) la genera el proveedor
  // de facturación; el PDF interno solo se usa con el simulador.
  const pdfUrl = receipt.pdfUrl ?? `${base}/r/pdf?t=${encodeURIComponent(pdf.token)}`;
  const number = receipt.officialNumber ?? `${receipt.series}-${String(receipt.correlative).padStart(8, "0")}`;
  const text = `${businessName(business)} te envía tu ${DOCUMENT_LABEL[receipt.documentType]} ${number} por S/ ${receipt.total.toFixed(2)}. Ver comprobante: ${viewUrl}`;
  return {
    documentType: receipt.documentType,
    documentNumber: number,
    total: receipt.total,
    viewUrl,
    pdfUrl,
    whatsappText: text,
    emailSubject: `${DOCUMENT_LABEL[receipt.documentType].toUpperCase()} ${number} - ${businessName(business)}`,
    emailBody: text,
    expiresAt: view.expiresAt.toISOString()
  };
}
