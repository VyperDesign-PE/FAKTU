import type { BillingIssueResult, IssueDocumentCommand, ProviderHealth } from "./contracts.js";

export interface BillingProvider {
  readonly code: BillingIssueResult["providerCode"];
  issueDocument(command: IssueDocumentCommand): Promise<BillingIssueResult>;
  getDocumentStatus?(command: IssueDocumentCommand): Promise<BillingIssueResult>;
  /** Representación impresa oficial (PDF con QR y hash), si el proveedor la genera bajo demanda. */
  getDocumentPdf?(command: IssueDocumentCommand): Promise<Buffer>;
  health(): Promise<ProviderHealth>;
}
