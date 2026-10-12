import type { BillingProvider } from "../BillingProvider.js";
import type { BillingIssueResult, BillingProviderCode, IssueDocumentCommand, ProviderHealth } from "../contracts.js";

type Options = {
  code: Exclude<BillingProviderCode, "mock" | "external">;
  baseUrl?: string;
  token?: string;
  healthPath?: string;
  timeoutMs?: number;
};

/**
 * Safe probe for named providers before their native request/response mapper is enabled.
 * It intentionally refuses to issue documents so a canonical internal payload is never
 * sent by mistake to a vendor-specific endpoint.
 */
export class ConfiguredProviderProbe implements BillingProvider {
  readonly code: Options["code"];

  constructor(private readonly options: Options) {
    this.code = options.code;
  }

  async health(): Promise<ProviderHealth> {
    if (!this.options.baseUrl) return "DOWN";
    if (!this.options.healthPath) return "DEGRADED";

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 8000);
    try {
      const response = await fetch(new URL(this.options.healthPath, this.options.baseUrl), {
        method: "GET",
        signal: controller.signal,
        headers: this.options.token ? { Authorization: `Bearer ${this.options.token}` } : undefined
      });
      return response.ok ? "UP" : "DEGRADED";
    } catch {
      return "DOWN";
    } finally {
      clearTimeout(timeout);
    }
  }

  async issueDocument(_command: IssueDocumentCommand): Promise<BillingIssueResult> {
    return {
      providerCode: this.code,
      status: "REJECTED",
      message: `El adaptador nativo de ${this.code} aun no esta habilitado. Usa sandbox/mock hasta completar la homologacion del contrato del proveedor.`
    };
  }
}
