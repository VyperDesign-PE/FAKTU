import type { BillingProvider } from "../BillingProvider.js";
import type { BillingIssueResult, IssueDocumentCommand, ProviderHealth } from "../contracts.js";

export class MockBillingProvider implements BillingProvider {
  readonly code = "mock" as const;

  async health(): Promise<ProviderHealth> {
    return "UP";
  }

  async issueDocument(command: IssueDocumentCommand): Promise<BillingIssueResult> {
    await new Promise((resolve) => setTimeout(resolve, 200));
    const officialNumber = `${command.series}-${String(command.correlative).padStart(8, "0")}`;
    return {
      providerCode: this.code,
      status: "ACCEPTED",
      officialNumber,
      providerDocumentId: `mock-${command.tenantId.slice(0, 8)}-${command.correlative}`,
      message: "Aceptado por el proveedor de prueba"
    };
  }
}
