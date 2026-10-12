import type { BillingIssueResult, IssueDocumentCommand, ProviderHealth } from "./contracts.js";

export interface BillingProvider {
  readonly code: BillingIssueResult["providerCode"];
  issueDocument(command: IssueDocumentCommand): Promise<BillingIssueResult>;
  getDocumentStatus?(command: IssueDocumentCommand): Promise<BillingIssueResult>;
  health(): Promise<ProviderHealth>;
}
