import type { BillingProvider } from "../BillingProvider.js";
import type {
  BillingIssueResult,
  DespatchCommand,
  DespatchResult,
  IssueDocumentCommand,
  ProviderHealth,
  VoidingCommand,
  VoidingResult
} from "../contracts.js";

/** Simulador: acepta todo de inmediato. Solo para práctica y pruebas. */
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

  async requestVoiding(command: VoidingCommand): Promise<VoidingResult> {
    return { providerCode: this.code, status: "ACCEPTED", ticket: `mock-baja-${command.voidingId.slice(0, 8)}`, message: "Baja aceptada por el proveedor de prueba" };
  }

  async getVoidingStatus(command: VoidingCommand): Promise<VoidingResult> {
    return this.requestVoiding(command);
  }

  async issueDespatch(command: DespatchCommand): Promise<DespatchResult> {
    return { providerCode: this.code, status: "ACCEPTED", ticket: `mock-guia-${command.guideId.slice(0, 8)}`, message: "Guía aceptada por el proveedor de prueba" };
  }

  async getDespatchStatus(command: DespatchCommand): Promise<DespatchResult> {
    return this.issueDespatch(command);
  }
}
