export type DocumentType = "DNI" | "RUC";

export type CustomerDocumentResult = {
  tipoDoc: DocumentType;
  numero: string;
  nombreCompleto: string;
  direccion?: string;
  estado?: string;
  condicion?: string;
  source: "MOCK" | "APIPERU_DEV" | "EXTERNAL" | "CACHE_SERVER" | "SUNAT_RUC_PADRON";
  originalSource?: string;
  sourceUpdatedAt?: string;
  customerId?: string;
};

export class CustomerDocumentLookupError extends Error {
  constructor(
    message: string,
    public readonly code: "INVALID_DOCUMENT" | "NOT_FOUND" | "UPSTREAM_UNAVAILABLE" | "UPSTREAM_ERROR" | "CONFIGURATION_ERROR",
    public readonly retryable = false,
    public readonly statusCode = 502
  ) {
    super(message);
    this.name = "CustomerDocumentLookupError";
  }
}
