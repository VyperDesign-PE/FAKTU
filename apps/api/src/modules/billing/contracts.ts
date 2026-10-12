export type BillingProviderCode = "mock" | "apisperu" | "nubefact" | "efact" | "senda" | "facturadorpe" | "cpeapi" | "external";
export type BillingEnvironment = "sandbox" | "production";
export type BillingDocumentType = "BOLETA" | "FACTURA" | "NOTA_CREDITO" | "NOTA_DEBITO";
/** Comprobantes de venta, a los que se asocian notas de crédito o débito. */
export type SaleDocumentType = "BOLETA" | "FACTURA";
export type NoteDocumentType = "NOTA_CREDITO" | "NOTA_DEBITO";

export function isNoteType(type: BillingDocumentType): type is NoteDocumentType {
  return type === "NOTA_CREDITO" || type === "NOTA_DEBITO";
}

/** Catálogo SUNAT 09 (motivos de nota de crédito) soportados por FAKTU. */
export const CREDIT_NOTE_REASONS = {
  "01": "ANULACION DE LA OPERACION",
  "02": "ANULACION POR ERROR EN EL RUC",
  "06": "DEVOLUCION TOTAL",
  "07": "DEVOLUCION POR ITEM",
  "09": "DISMINUCION EN EL VALOR"
} as const;
export type CreditNoteReasonCode = keyof typeof CREDIT_NOTE_REASONS;
/** Motivos que anulan el comprobante completo (solo una nota vigente por comprobante). */
export const TOTAL_CREDIT_NOTE_REASONS: CreditNoteReasonCode[] = ["01", "02", "06"];

/** Catálogo SUNAT 10 (motivos de nota de débito). */
export const DEBIT_NOTE_REASONS = {
  "01": "INTERESES POR MORA",
  "02": "AUMENTO EN EL VALOR",
  "03": "PENALIDADES / OTROS CONCEPTOS"
} as const;
export type DebitNoteReasonCode = keyof typeof DEBIT_NOTE_REASONS;

export const PAYMENT_METHODS = ["EFECTIVO", "YAPE", "PLIN", "TARJETA", "TRANSFERENCIA"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Documento al que hace referencia una nota de crédito. */
export type RelatedDocument = {
  documentType: SaleDocumentType;
  series: string;
  correlative: number;
};

/** Motivo SUNAT de una nota (catálogo 09 crédito / 10 débito) y su sustento. */
export type NoteReason = {
  code: string;
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
  /** Solo para notas de crédito y débito. */
  relatedDocument?: RelatedDocument;
  /** Solo para notas de crédito y débito. */
  noteReason?: NoteReason;
  /** Modo práctica: lo procesa el simulador, nunca un proveedor real. */
  practice?: boolean;
};

// ---------- Comunicación de baja ----------

/** Comunicación de baja (facturas y sus notas) o resumen diario con estado 3 (boletas). */
export type VoidingKind = "COMUNICACION_BAJA" | "RESUMEN_BAJA";

export type VoidingCommand = {
  tenantId: string;
  voidingId: string;
  kind: VoidingKind;
  /** Correlativo del día para RA-/RC-AAAAMMDD-n. */
  correlative: number;
  reason: string;
  issuer?: BillingIssuer;
  practice?: boolean;
  /** Fecha de la comunicación (hoy). */
  communicationDate: string;
  document: {
    documentType: BillingDocumentType;
    series: string;
    correlative: number;
    issueDate: string;
    customer?: BillingCustomer;
    subtotal: number;
    igv: number;
    total: number;
  };
};

export type VoidingResult = {
  providerCode: BillingProviderCode;
  status: "ACCEPTED" | "REJECTED" | "PENDING";
  ticket?: string;
  message: string;
  rawResponse?: unknown;
};

// ---------- Guías de remisión ----------

export type DespatchGuideType = "REMITENTE" | "TRANSPORTISTA";

export type DespatchParty = {
  documentType: "6" | "1" | "4" | "7";
  documentNumber: string;
  name: string;
  address?: string;
};

export type DespatchPlace = {
  ubigeo: string;
  address: string;
};

export type DespatchDriver = {
  documentType: "1" | "4" | "7";
  documentNumber: string;
  names: string;
  surnames: string;
  license: string;
};

export type DespatchData = {
  /** Remitente: destinatario. Transportista: destinatario final. */
  recipient: DespatchParty;
  /** Solo transportista: quien envía los bienes. */
  shipper?: DespatchParty;
  /** Catálogo 20 (solo remitente). */
  reasonCode?: string;
  reasonDescription?: string;
  /** Catálogo 18: 01 público, 02 privado (solo remitente). */
  transportMode?: "01" | "02";
  transferDate: string;
  grossWeight: number;
  weightUnit: "KGM" | "TNE";
  packages?: number;
  origin: DespatchPlace;
  destination: DespatchPlace;
  /** Transporte público (remitente 01): empresa de transportes. */
  carrier?: { documentNumber: string; name: string; mtcNumber?: string };
  vehiclePlate?: string;
  driver?: DespatchDriver;
  notes?: string;
  items: Array<{ code?: string; description: string; quantity: number; unit: string }>;
  relatedDocument?: { documentType: SaleDocumentType; series: string; correlative: number };
};

export type DespatchCommand = {
  tenantId: string;
  guideId: string;
  guideType: DespatchGuideType;
  series: string;
  correlative: number;
  issueDate: string;
  data: DespatchData;
  issuer?: BillingIssuer;
  practice?: boolean;
};

export type DespatchResult = {
  providerCode: BillingProviderCode;
  status: "ACCEPTED" | "REJECTED" | "PENDING";
  ticket?: string;
  message: string;
  pdfUrl?: string;
  xmlUrl?: string;
  cdrUrl?: string;
  hash?: string;
  qrData?: string;
  rawResponse?: unknown;
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
