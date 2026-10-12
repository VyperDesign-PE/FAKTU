import type {
  BillingIssuer,
  BillingIssueResult,
  DespatchCommand,
  DespatchResult,
  IssueDocumentCommand,
  VoidingCommand,
  VoidingResult
} from "./contracts.js";
import type { BillingProvider } from "./BillingProvider.js";
import { createBillingProvider } from "./providerFactory.js";
import { MockBillingProvider } from "./providers/MockBillingProvider.js";
import { getTenantBillingConfig } from "./tenantBillingConfigRepository.js";
import { resolveBillingCredential, resolveBillingEndpoint } from "./secretResolver.js";
import { getBusiness } from "../tenants/tenantRepository.js";
import type { TenantBillingConfig } from "./contracts.js";

export class BillingConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingConfigError";
  }
}

function flag(name: string) {
  return (process.env[name] ?? "false").toLowerCase() === "true";
}

/**
 * Barreras para no entregar comprobantes sin validez tributaria a un cliente real.
 */
export function assertIssuingAllowed(config: TenantBillingConfig) {
  // El modo práctica (simulador con series "T", marcado como prueba en la app y
  // en el comprobante) está permitido salvo que se desactive explícitamente.
  if (config.providerCode === "mock" && process.env.NODE_ENV === "production" && (process.env.ALLOW_MOCK_BILLING ?? "true").toLowerCase() === "false") {
    throw new BillingConfigError("Este negocio aún no tiene activo un proveedor de facturación electrónica. Contacta a soporte.");
  }
  if (config.environment === "production" && !flag("BILLING_PRODUCTION_ENABLED")) {
    throw new BillingConfigError("La emisión en producción todavía no está habilitada en FAKTU.");
  }
}

async function runtimeForTenant(tenantId: string) {
  const config = await getTenantBillingConfig(tenantId);
  const business = await getBusiness(tenantId);
  const credential = config.providerCode === "mock" ? undefined : resolveBillingCredential(config);
  const issuer: BillingIssuer | undefined = business?.ruc && business.businessName
    ? {
        ruc: business.ruc,
        legalName: business.businessName,
        tradeName: business.tradeName,
        address: {
          address: business.address,
          ubigeo: business.ubigeo,
          department: business.department,
          province: business.province,
          district: business.district
        }
      }
    : undefined;
  const endpoint = config.providerCode === "mock" ? undefined : resolveBillingEndpoint(config);
  return { config, credential, endpoint, issuer };
}

export class BillingService {
  async issueDocument(command: IssueDocumentCommand): Promise<BillingIssueResult> {
    // Una venta de práctica jamás llega a un proveedor real, aunque el negocio
    // se haya activado mientras estaba pendiente.
    if (command.practice) return new MockBillingProvider().issueDocument(command);
    const runtime = await runtimeForTenant(command.tenantId);
    assertIssuingAllowed(runtime.config);
    const provider = createBillingProvider(runtime.config, runtime);
    return provider.issueDocument({ ...command, issuer: command.issuer ?? runtime.issuer });
  }

  async reconcileDocument(command: IssueDocumentCommand): Promise<BillingIssueResult> {
    if (command.practice) {
      return { providerCode: "mock", status: "PENDING", officialNumber: `${command.series}-${command.correlative}`, message: "Venta de práctica pendiente." };
    }
    const runtime = await runtimeForTenant(command.tenantId);
    const provider = createBillingProvider(runtime.config, runtime);
    if (!provider.getDocumentStatus) {
      return {
        providerCode: provider.code,
        status: "PENDING",
        officialNumber: `${command.series}-${command.correlative}`,
        message: "Este proveedor todavía no implementa conciliacion automatica de estado."
      };
    }
    return provider.getDocumentStatus({ ...command, issuer: command.issuer ?? runtime.issuer });
  }

  /** Proveedor para documentos asíncronos (bajas, guías): simulador si es práctica. */
  private async asyncProvider(tenantId: string, practice: boolean | undefined) {
    if (practice) return { provider: new MockBillingProvider() as BillingProvider, issuer: undefined as BillingIssuer | undefined };
    const runtime = await runtimeForTenant(tenantId);
    assertIssuingAllowed(runtime.config);
    return { provider: createBillingProvider(runtime.config, runtime), issuer: runtime.issuer };
  }

  async requestVoiding(command: VoidingCommand): Promise<VoidingResult> {
    const { provider, issuer } = await this.asyncProvider(command.tenantId, command.practice);
    if (!provider.requestVoiding) throw new BillingConfigError(`El proveedor ${provider.code} no permite comunicaciones de baja desde FAKTU.`);
    return provider.requestVoiding({ ...command, issuer: command.issuer ?? issuer });
  }

  async voidingStatus(command: VoidingCommand, ticket?: string): Promise<VoidingResult> {
    const { provider, issuer } = await this.asyncProvider(command.tenantId, command.practice);
    if (!provider.getVoidingStatus) return { providerCode: provider.code, status: "PENDING", ticket, message: "Este proveedor no permite consultar bajas." };
    return provider.getVoidingStatus({ ...command, issuer: command.issuer ?? issuer }, ticket);
  }

  async issueDespatch(command: DespatchCommand): Promise<DespatchResult> {
    const { provider, issuer } = await this.asyncProvider(command.tenantId, command.practice);
    if (!provider.issueDespatch) throw new BillingConfigError(`El proveedor ${provider.code} no permite guías de remisión desde FAKTU.`);
    return provider.issueDespatch({ ...command, issuer: command.issuer ?? issuer });
  }

  async despatchStatus(command: DespatchCommand, ticket?: string): Promise<DespatchResult> {
    const { provider, issuer } = await this.asyncProvider(command.tenantId, command.practice);
    if (!provider.getDespatchStatus) return { providerCode: provider.code, status: "PENDING", ticket, message: "Este proveedor no permite consultar guías." };
    return provider.getDespatchStatus({ ...command, issuer: command.issuer ?? issuer }, ticket);
  }

  async despatchPdf(command: DespatchCommand): Promise<Buffer | undefined> {
    if (command.practice) return undefined;
    const runtime = await runtimeForTenant(command.tenantId);
    const provider = createBillingProvider(runtime.config, runtime);
    if (!provider.getDespatchPdf) return undefined;
    return provider.getDespatchPdf({ ...command, issuer: command.issuer ?? runtime.issuer });
  }

  /** PDF oficial generado por el proveedor; undefined si no lo ofrece o es práctica. */
  async documentPdf(command: IssueDocumentCommand): Promise<Buffer | undefined> {
    if (command.practice) return undefined;
    const runtime = await runtimeForTenant(command.tenantId);
    const provider = createBillingProvider(runtime.config, runtime);
    if (!provider.getDocumentPdf) return undefined;
    return provider.getDocumentPdf({ ...command, issuer: command.issuer ?? runtime.issuer });
  }

  async health(tenantId: string): Promise<{ providerCode: string; status: Awaited<ReturnType<BillingProvider["health"]>>; message?: string }> {
    const config = await getTenantBillingConfig(tenantId);
    try {
      const runtime = await runtimeForTenant(tenantId);
      const provider = createBillingProvider(runtime.config, runtime);
      return { providerCode: provider.code, status: await provider.health() };
    } catch (error) {
      return { providerCode: config.providerCode, status: "DOWN", message: error instanceof Error ? error.message : undefined };
    }
  }
}
