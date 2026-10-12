import type { BillingIssuer, BillingIssueResult, IssueDocumentCommand } from "./contracts.js";
import type { BillingProvider } from "./BillingProvider.js";
import { createBillingProvider } from "./providerFactory.js";
import { getTenantBillingConfig } from "./tenantBillingConfigRepository.js";
import { resolveBillingCredential } from "./secretResolver.js";
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
  if (config.providerCode === "mock" && process.env.NODE_ENV === "production" && !flag("ALLOW_MOCK_BILLING")) {
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
  return { config, credential, issuer };
}

export class BillingService {
  async issueDocument(command: IssueDocumentCommand): Promise<BillingIssueResult> {
    const runtime = await runtimeForTenant(command.tenantId);
    assertIssuingAllowed(runtime.config);
    const provider = createBillingProvider(runtime.config, runtime);
    return provider.issueDocument({ ...command, issuer: command.issuer ?? runtime.issuer });
  }

  async reconcileDocument(command: IssueDocumentCommand): Promise<BillingIssueResult> {
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
