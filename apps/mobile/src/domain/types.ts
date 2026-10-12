export type DocumentType = "BOLETA" | "FACTURA";
/**
 * PENDING/SYNCING/ERROR: se reintentará. ACCEPTED/REJECTED: estado final.
 * REJECTED incluye rechazos de SUNAT y ventas inválidas (no se reintentan).
 */
export type ReceiptStatus = "PENDING" | "SYNCING" | "ACCEPTED" | "REJECTED" | "ERROR";

export function isFinalReceiptStatus(status: ReceiptStatus) {
  return status === "ACCEPTED" || status === "REJECTED";
}
export type CustomerDocumentType = "DNI" | "RUC";
export type PaymentMethod = "EFECTIVO" | "YAPE" | "PLIN" | "TARJETA" | "TRANSFERENCIA";
export const PAYMENT_METHODS: Array<{ value: PaymentMethod; label: string }> = [
  { value: "EFECTIVO", label: "Efectivo" },
  { value: "YAPE", label: "Yape" },
  { value: "PLIN", label: "Plin" },
  { value: "TARJETA", label: "Tarjeta" },
  { value: "TRANSFERENCIA", label: "Transferencia" }
];

export type Product = {
  id: string;
  name: string;
  unitPrice: number;
  unit?: string;
  favorite?: boolean;
};

export type SaleItem = Product & {
  quantity: number;
};

export type Customer = {
  documentType?: CustomerDocumentType;
  documentNumber?: string;
  name?: string;
  address?: string;
  phone?: string;
  email?: string;
};

export type SaleDraft = {
  items: SaleItem[];
  documentType: DocumentType;
  customer?: Customer;
  paymentMethod: PaymentMethod;
  /** Monto entregado en efectivo, para calcular el vuelto. */
  amountReceived?: number;
};

export type PendingReceipt = {
  clientTransactionId: string;
  temporaryNumber: string;
  createdAt: string;
  documentType: DocumentType;
  items: SaleItem[];
  customer?: Customer;
  total: number;
  paymentMethod?: PaymentMethod;
  amountReceived?: number;
  status: ReceiptStatus;
  errorMessage?: string;
  officialNumber?: string;
  /** true si lo emitió el simulador: sin validez tributaria. */
  testMode?: boolean;
};

export type BusinessProfile = {
  phone?: string;
  ruc?: string;
  businessName?: string;
  tradeName?: string;
  address?: string;
  taxpayerStatus?: string;
  sunatUser?: string;
  onboardingComplete: boolean;
};
