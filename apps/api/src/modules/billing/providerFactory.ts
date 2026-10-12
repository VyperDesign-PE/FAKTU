import type { BillingProvider } from "./BillingProvider.js";
import type { BillingIssuer, TenantBillingConfig } from "./contracts.js";
import { MockBillingProvider } from "./providers/MockBillingProvider.js";
import { ExternalRestBillingProvider } from "./providers/ExternalRestBillingProvider.js";
import { ConfiguredProviderProbe } from "./providers/ConfiguredProviderProbe.js";
import { ApiPeruBillingProvider } from "./providers/ApiPeruBillingProvider.js";

export type BillingProviderRuntime = {
  credential?: string;
  issuer?: BillingIssuer;
};

export function createBillingProvider(config: TenantBillingConfig, runtime: BillingProviderRuntime = {}): BillingProvider {
  if (config.providerCode === "mock") return new MockBillingProvider();

  const prefix = config.providerCode.toUpperCase();
  const baseUrl = process.env[`${prefix}_API_BASE_URL`] ?? process.env.BILLING_API_BASE_URL;
  const token = runtime.credential ?? process.env[`${prefix}_API_TOKEN`] ?? process.env.BILLING_API_TOKEN;
  const healthPath = process.env[`${prefix}_HEALTH_PATH`] ?? process.env.BILLING_HEALTH_PATH;

  if (config.providerCode === "apisperu") {
    if (!token) throw new Error("Falta configurar el token de empresa de APIsPERU para este negocio.");
    if (!runtime.issuer) throw new Error("Faltan los datos tributarios del negocio para conectar APIsPERU.");
    return new ApiPeruBillingProvider({
      token,
      issuer: runtime.issuer,
      baseUrl: baseUrl ?? "https://facturacion.apisperu.com/api/v1/",
      timeoutMs: Number(process.env.APISPERU_TIMEOUT_MS ?? 15000)
    });
  }

  // "external" is reserved for a normalized gateway whose contract is exactly ours.
  if (config.providerCode === "external") {
    const issuePath = process.env.EXTERNAL_ISSUE_PATH ?? process.env.BILLING_ISSUE_PATH ?? "/documents";
    if (!baseUrl || !token) {
      throw new Error("Falta configurar EXTERNAL_API_BASE_URL/BILLING_API_BASE_URL y el token del gateway normalizado");
    }
    return new ExternalRestBillingProvider({
      code: "external",
      baseUrl,
      token,
      issuePath,
      healthPath
    });
  }

  // Other named vendors require provider-specific adapters. Until then, only probe connectivity.
  return new ConfiguredProviderProbe({
    code: config.providerCode,
    baseUrl,
    token,
    healthPath
  });
}
