import type { TenantBillingConfig } from "./contracts.js";

/**
 * Resuelve la credencial del proveedor de facturación de un negocio.
 *
 * Reglas de seguridad:
 * - El negocio NO elige qué secreto se usa. La referencia la asigna la
 *   plataforma (operaciones) y solo puede apuntar a variables con el prefijo
 *   BILLING_TOKEN_, nunca a JWT_SECRET, DATABASE_URL u otras.
 * - Por defecto cada negocio usa su propia variable BILLING_TOKEN_<tenantId>
 *   (tenantId sin guiones, en mayúsculas), que solo operaciones puede definir.
 * - Un token compartido (APISPERU_API_TOKEN / BILLING_API_TOKEN) solo se admite
 *   en sandbox y si BILLING_ALLOW_SHARED_SANDBOX_TOKEN=true. En producción
 *   jamás se emite con credenciales de otra empresa.
 * - Los mensajes de error no revelan nombres de variables al usuario final.
 *
 * Producción: sustituir la lectura de process.env por AWS Secrets Manager,
 * GCP Secret Manager, Azure Key Vault o equivalente manteniendo esta interfaz.
 */
export const TENANT_SECRET_PREFIX = "BILLING_TOKEN_";

export class BillingCredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingCredentialError";
  }
}

export function tenantSecretEnvName(tenantId: string) {
  return `${TENANT_SECRET_PREFIX}${tenantId.replace(/-/g, "").toUpperCase()}`;
}

export function isAllowedSecretRef(ref: string) {
  if (!ref.startsWith("env:")) return false;
  const name = ref.slice(4).trim();
  return new RegExp(`^${TENANT_SECRET_PREFIX}[A-Z0-9_]+$`).test(name);
}

function sharedSandboxToken(config: TenantBillingConfig) {
  if (config.environment !== "sandbox") return undefined;
  if ((process.env.BILLING_ALLOW_SHARED_SANDBOX_TOKEN ?? "false").toLowerCase() !== "true") return undefined;
  const providerVar = `${config.providerCode.toUpperCase()}_API_TOKEN`;
  return process.env[providerVar]?.trim() || process.env.BILLING_API_TOKEN?.trim() || undefined;
}

export function resolveBillingCredential(config: TenantBillingConfig): string | undefined {
  const ref = config.credentialSecretRef?.trim();
  if (ref) {
    if (!isAllowedSecretRef(ref)) {
      throw new BillingCredentialError("La credencial de facturación de este negocio no está bien configurada. Contacta a soporte.");
    }
    const value = process.env[ref.slice(4).trim()]?.trim();
    if (value) return value;
  }

  const ownToken = process.env[tenantSecretEnvName(config.tenantId)]?.trim();
  if (ownToken) return ownToken;

  return sharedSandboxToken(config);
}

export const TENANT_URL_PREFIX = "BILLING_URL_";

export function tenantUrlEnvName(tenantId: string) {
  return `${TENANT_URL_PREFIX}${tenantId.replace(/-/g, "").toUpperCase()}`;
}

/**
 * Ruta (URL) de la cuenta del proveedor para proveedores con una ruta por
 * empresa, como Nubefact. También la define operaciones, nunca el negocio:
 * si el negocio pudiera elegirla, podría enviar el token a un servidor ajeno.
 */
export function resolveBillingEndpoint(config: TenantBillingConfig): string | undefined {
  const own = process.env[tenantUrlEnvName(config.tenantId)]?.trim();
  if (own) return own;
  if (config.environment !== "sandbox") return undefined;
  if ((process.env.BILLING_ALLOW_SHARED_SANDBOX_TOKEN ?? "false").toLowerCase() !== "true") return undefined;
  return process.env[`${config.providerCode.toUpperCase()}_API_URL`]?.trim() || undefined;
}

export function hasBillingCredential(config: TenantBillingConfig) {
  try {
    const credential = resolveBillingCredential(config);
    if (config.providerCode === "nubefact") return Boolean(credential && resolveBillingEndpoint(config));
    return Boolean(credential);
  } catch {
    return false;
  }
}
