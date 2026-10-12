import { sql } from "../../db/client.js";
import type { BillingEnvironment, BillingProviderCode, TenantBillingConfig } from "./contracts.js";

export const validProviders = new Set<BillingProviderCode>(["mock", "apisperu", "nubefact", "efact", "senda", "facturadorpe", "cpeapi", "external"]);

export async function getTenantBillingConfig(tenantId: string): Promise<TenantBillingConfig> {
  const rows = await sql`
    select provider_code, environment, provider_account_ref, credential_secret_ref
    from tenant_billing_settings
    where tenant_id = ${tenantId}
    limit 1
  `;
  const row = rows[0] as {
    provider_code?: string;
    environment?: string;
    provider_account_ref?: string;
    credential_secret_ref?: string;
  } | undefined;

  const fallbackProvider = (process.env.BILLING_PROVIDER ?? "mock") as BillingProviderCode;
  const providerCode = row?.provider_code && validProviders.has(row.provider_code as BillingProviderCode)
    ? row.provider_code as BillingProviderCode
    : validProviders.has(fallbackProvider)
      ? fallbackProvider
      : "mock";

  const environment: BillingEnvironment = row?.environment === "production" ? "production" : "sandbox";
  return {
    tenantId,
    providerCode,
    environment,
    providerAccountRef: row?.provider_account_ref,
    credentialSecretRef: row?.credential_secret_ref
  };
}


export async function updateTenantBillingConfig(input: TenantBillingConfig): Promise<TenantBillingConfig> {
  if (!validProviders.has(input.providerCode)) throw new Error("Proveedor de facturacion no permitido");
  await sql`
    insert into tenant_billing_settings (
      tenant_id, provider_code, environment, provider_account_ref, credential_secret_ref, updated_at
    ) values (
      ${input.tenantId}, ${input.providerCode}, ${input.environment},
      ${input.providerAccountRef ?? null}, ${input.credentialSecretRef ?? null}, now()
    )
    on conflict (tenant_id) do update set
      provider_code = excluded.provider_code,
      environment = excluded.environment,
      provider_account_ref = excluded.provider_account_ref,
      credential_secret_ref = excluded.credential_secret_ref,
      updated_at = now()
  `;
  return getTenantBillingConfig(input.tenantId);
}

export async function recordBillingConnectionTest(tenantId: string, ok: boolean, message?: string) {
  await sql`
    update tenant_billing_settings
    set connection_status = ${ok ? "CONNECTED" : "ERROR"},
        last_tested_at = now(),
        last_error = ${ok ? null : (message ?? "No se pudo validar la conexion")},
        updated_at = now()
    where tenant_id = ${tenantId}
  `;
}

export async function getBillingConnectionState(tenantId: string) {
  const rows = await sql`
    select connection_status, last_tested_at, last_error
    from tenant_billing_settings
    where tenant_id = ${tenantId}
    limit 1
  `;
  const row = rows[0] as { connection_status?: string; last_tested_at?: string; last_error?: string } | undefined;
  return {
    connectionStatus: row?.connection_status ?? "NOT_TESTED",
    lastTestedAt: row?.last_tested_at,
    lastError: row?.last_error
  };
}
