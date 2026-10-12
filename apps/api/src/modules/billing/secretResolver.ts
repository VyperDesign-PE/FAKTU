import type { BillingProviderCode, TenantBillingConfig } from "./contracts.js";

function providerEnvName(providerCode: BillingProviderCode) {
  return `${providerCode.toUpperCase()}_API_TOKEN`;
}

/**
 * Resuelve credenciales sin guardar secretos en texto plano en PostgreSQL.
 *
 * MVP:
 * - credentialSecretRef = "env:NOMBRE_VARIABLE"
 * - o fallback PROVIDER_API_TOKEN en variables de entorno.
 *
 * Produccion:
 * sustituir esta funcion por AWS Secrets Manager, GCP Secret Manager,
 * Azure Key Vault o equivalente manteniendo la misma interfaz.
 */
export function resolveBillingCredential(config: TenantBillingConfig): string | undefined {
  const ref = config.credentialSecretRef?.trim();
  if (ref) {
    if (!ref.startsWith("env:")) {
      throw new Error("La referencia de credencial no es compatible. Usa env:NOMBRE_VARIABLE en el MVP.");
    }
    const envName = ref.slice(4).trim();
    if (!/^[A-Z0-9_]+$/i.test(envName)) throw new Error("Referencia de credencial invalida");
    const value = process.env[envName]?.trim();
    if (!value) throw new Error(`No existe la variable de entorno ${envName} para este negocio.`);
    return value;
  }

  return process.env[providerEnvName(config.providerCode)]?.trim() || process.env.BILLING_API_TOKEN?.trim();
}
