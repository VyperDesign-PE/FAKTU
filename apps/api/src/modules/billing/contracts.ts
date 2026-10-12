export type BillingProviderCode = "mock" | "apisperu" | "nubefact" | "efact" | "senda" | "facturadorpe" | "cpeapi" | "external";
export type BillingEnvironment = "sandbox" | "production";
export type BillingDocumentType = "BOLETA" | "FACTURA" | "NOTA_CREDITO";
/** Comprobantes de venta que pueden anularse con una nota de crédito. */
export type SaleDocumentType = Exclude<BillingDocumentType, "NOTA_CREDITO">;

export const PAYMENT_METHODS = ["EFECTIVO", "YAPE", "PLIN", "TARJETA", "TRANSFERENCIA"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Documento al que hace referencia una nota de crédito. */
export type RelatedDocument = {
  documentType: SaleDocumentType;
  series: string;
  correlative: number;
};

/** Motivo SUNAT de la nota de crédito (catálogo 09). FAKTU usa 01 = anulación de la operación. */
export type CreditNoteReason = {
  code: "01";
  description: string;
};

export type BillingAddress = {
  address?: string;
  ubigeo?: string;
  department?: string;
  province?: string;
  district?: string;
};

export type BillingIssuer = {
  ruc: string;
  legalName: string;
  tradeName?: string;
  address?: BillingAddress;
};

export type BillingCustomer = {
  documentType?: "DNI" | "RUC";
  documentNumber?: string;
  name?: string;
  address?: string;
};

export type BillingItem = {
  sku?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  unitCode?: string;
};

export type IssueDocumentCommand = {
  tenantId: string;
  clientTransactionId: string;
  documentType: BillingDocumentType;
  series: string;
  correlative: number;
  currency: "PEN";
  issueDate: string;
  issuer?: BillingIssuer;
  customer?: BillingCustomer;
  items: BillingItem[];
  subtotal: number;
  igv: number;
  total: number;
  paymentMethod?: PaymentMethod;
  /** Solo para NOTA_CREDITO. */
  relatedDocument?: RelatedDocument;
  /** Solo para NOTA_CREDITO. */
  creditNoteReason?: CreditNoteReason;
};

export type BillingProviderArtifacts = {
  hash?: string;
  xmlContent?: string;
  cdrZipBase64?: string;
  /** Cadena SUNAT para el código QR de la representación impresa. */
  qrData?: string;
  rawResponse?: unknown;
};

export type BillingIssueResult = {
  providerCode: BillingProviderCode;
  status: "ACCEPTED" | "REJECTED" | "PENDING";
  officialNumber?: string;
  providerDocumentId?: string;
  message: string;
  pdfUrl?: string;
  xmlUrl?: string;
  cdrUrl?: string;
  artifacts?: BillingProviderArtifacts;
};

export type ProviderHealth = "UP" | "DOWN" | "DEGRADED";

export type TenantBillingConfig = {
  tenantId: string;
  providerCode: BillingProviderCode;
  environment: BillingEnvironment;
  providerAccountRef?: string;
  credentialSecretRef?: string;
};
