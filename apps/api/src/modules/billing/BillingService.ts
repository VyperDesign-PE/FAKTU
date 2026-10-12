import type { BillingIssuer, BillingIssueResult, IssueDocumentCommand } from "./contracts.js";
import { createBillingProvider } from "./providerFactory.js";
import { getTenantBillingConfig } from "./tenantBillingConfigRepository.js";
import { resolveBillingCredential } from "./secretResolver.js";
import { getBusiness } from "../tenants/tenantRepository.js";

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

  async health(tenantId: string) {
    const runtime = await runtimeForTenant(tenantId);
    const provider = createBillingProvider(runtime.config, runtime);
    return { providerCode: provider.code, status: await provider.health() };
  }
}
