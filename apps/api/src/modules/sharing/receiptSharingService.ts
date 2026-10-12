import { createReceiptLinkToken, publicBaseUrl, receiptLinkTtlSeconds } from "./publicReceiptLinks.js";
import type { ReceiptRecord } from "../receipts/receiptRepository.js";
import type { BusinessRecord } from "../tenants/tenantRepository.js";

export type ReceiptSharePackage = {
  documentType: "BOLETA" | "FACTURA";
  documentNumber: string;
  total: number;
  viewUrl: string;
  pdfUrl: string;
  whatsappText: string;
  emailSubject: string;
  emailBody: string;
  expiresAt: string;
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
  const pdfUrl = `${base}/r/pdf?t=${encodeURIComponent(pdf.token)}`;
  const number = receipt.officialNumber ?? `${receipt.series}-${String(receipt.correlative).padStart(8, "0")}`;
  const text = `${businessName(business)} te envía tu ${receipt.documentType.toLowerCase()} ${number} por S/ ${receipt.total.toFixed(2)}. Ver comprobante: ${viewUrl}`;
  return {
    documentType: receipt.documentType,
    documentNumber: number,
    total: receipt.total,
    viewUrl,
    pdfUrl,
    whatsappText: text,
    emailSubject: `${receipt.documentType} ${number} - ${businessName(business)}`,
    emailBody: text,
    expiresAt: view.expiresAt.toISOString()
  };
}
