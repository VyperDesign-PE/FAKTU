/**
 * Operaciones: muestra lo necesario para activar la facturación de un negocio.
 *
 *   npm run ops:activation -- correo@negocio.pe
 *
 * Imprime el tenantId, RUC, estado actual y los nombres de las variables de
 * entorno donde va la RUTA y el TOKEN de su cuenta Nubefact. No imprime secretos.
 */
import { closeDatabase, sql } from "../db/client.js";
import { tenantSecretEnvName, tenantUrlEnvName, hasBillingCredential } from "../modules/billing/secretResolver.js";
import { getTenantBillingConfig } from "../modules/billing/tenantBillingConfigRepository.js";

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error("Uso: npm run ops:activation -- correo@negocio.pe");
  process.exit(1);
}

const rows = await sql<{ tenant_id: string; ruc: string | null; business_name: string | null; role: string }[]>`
  select m.tenant_id, t.ruc, t.legal_name as business_name, m.role
  from app_users u
  join tenant_memberships m on m.user_id = u.id
  join tenants t on t.id = m.tenant_id
  where u.email = ${email}
`;
if (!rows.length) {
  console.error(`No existe una cuenta con el correo ${email}.`);
  await closeDatabase();
  process.exit(1);
}

for (const row of rows) {
  const config = await getTenantBillingConfig(row.tenant_id);
  console.log(`
Negocio:     ${row.business_name ?? "(sin razón social)"}  RUC ${row.ruc ?? "(sin RUC)"}  [${row.role}]
tenantId:    ${row.tenant_id}
Proveedor:   ${config.providerCode} (${config.environment})  credencial configurada: ${hasBillingCredential(config) ? "sí" : "no"}

Para activar Nubefact, define en el servidor (gestor de secretos):
  ${tenantUrlEnvName(row.tenant_id)}=<RUTA de la cuenta Nubefact del negocio>
  ${tenantSecretEnvName(row.tenant_id)}=<TOKEN de esa cuenta>
y luego, tras reiniciar la API:
  update tenant_billing_settings set provider_code = 'nubefact', environment = 'sandbox' where tenant_id = '${row.tenant_id}';
(Usa environment = 'production' solo tras la homologación y con BILLING_PRODUCTION_ENABLED=true.)`);
}
await closeDatabase();
