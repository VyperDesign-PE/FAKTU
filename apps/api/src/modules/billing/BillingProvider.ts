import type {
  BillingIssueResult,
  DespatchCommand,
  DespatchResult,
  IssueDocumentCommand,
  ProviderHealth,
  VoidingCommand,
  VoidingResult
} from "./contracts.js";

export interface BillingProvider {
  readonly code: BillingIssueResult["providerCode"];
  issueDocument(command: IssueDocumentCommand): Promise<BillingIssueResult>;
  getDocumentStatus?(command: IssueDocumentCommand): Promise<BillingIssueResult>;
  /** Representación impresa oficial (PDF con QR y hash), si el proveedor la genera bajo demanda. */
  getDocumentPdf?(command: IssueDocumentCommand): Promise<Buffer>;

  /** Comunicación de baja / resumen de baja. Suele ser asíncrona (ticket). */
  requestVoiding?(command: VoidingCommand): Promise<VoidingResult>;
  getVoidingStatus?(command: VoidingCommand, ticket?: string): Promise<VoidingResult>;

  /** Guía de remisión electrónica. SUNAT la acepta de forma asíncrona. */
  issueDespatch?(command: DespatchCommand): Promise<DespatchResult>;
  getDespatchStatus?(command: DespatchCommand, ticket?: string): Promise<DespatchResult>;
  getDespatchPdf?(command: DespatchCommand): Promise<Buffer>;

  health(): Promise<ProviderHealth>;
}
