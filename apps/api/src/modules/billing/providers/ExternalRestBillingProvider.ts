import type { BillingProvider } from "../BillingProvider.js";
import type { BillingIssueResult, BillingProviderCode, IssueDocumentCommand, ProviderHealth } from "../contracts.js";

export type ExternalRestProviderOptions = {
  code: Exclude<BillingProviderCode, "mock">;
  baseUrl: string;
  token: string;
  issuePath: string;
  healthPath?: string;
  timeoutMs?: number;
};

/**
 * Adaptador HTTP genérico para un gateway externo normalizado.
 *
 * Importante: Nubefact, Facturador.pe y otras APIs tienen contratos propios.
 * Este adaptador NO asume que todos usan el mismo JSON; para una integración
 * directa se debe crear un adaptador específico que implemente BillingProvider
 * y traduzca nuestro modelo canónico al contrato del proveedor elegido.
 */
export class ExternalRestBillingProvider implements BillingProvider {
  readonly code: Exclude<BillingProviderCode, "mock">;

  constructor(private readonly options: ExternalRestProviderOptions) {
    this.code = options.code;
  }

  async health(): Promise<ProviderHealth> {
    if (!this.options.healthPath) return "UP";
    try {
      const response = await this.request(this.options.healthPath, { method: "GET" });
      return response.ok ? "UP" : "DEGRADED";
    } catch {
      return "DOWN";
    }
  }

  async issueDocument(command: IssueDocumentCommand): Promise<BillingIssueResult> {
    const response = await this.request(this.options.issuePath, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": command.clientTransactionId },
      body: JSON.stringify(command)
    });

    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      return {
        providerCode: this.code,
        status: "REJECTED",
        message: typeof body.message === "string" ? body.message : `Proveedor respondió HTTP ${response.status}`
      };
    }

    const status = body.status === "PENDING" ? "PENDING" : body.status === "REJECTED" ? "REJECTED" : "ACCEPTED";
    return {
      providerCode: this.code,
      status,
      officialNumber: typeof body.officialNumber === "string" ? body.officialNumber : undefined,
      providerDocumentId: typeof body.providerDocumentId === "string" ? body.providerDocumentId : undefined,
      message: typeof body.message === "string" ? body.message : "Documento procesado por proveedor externo",
      pdfUrl: typeof body.pdfUrl === "string" ? body.pdfUrl : undefined,
      xmlUrl: typeof body.xmlUrl === "string" ? body.xmlUrl : undefined,
      cdrUrl: typeof body.cdrUrl === "string" ? body.cdrUrl : undefined
    };
  }

  private async request(path: string, init: RequestInit) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 15000);
    try {
      return await fetch(new URL(path, this.options.baseUrl), {
        ...init,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.options.token}`,
          ...(init.headers ?? {})
        }
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}
