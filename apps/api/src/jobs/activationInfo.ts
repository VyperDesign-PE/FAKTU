/**
 * Operaciones: muestra lo necesario para activar la facturación de un negocio.
 *
 *   npm run ops:activation -- correo@negocio.pe [apisperu|nubefact]
 *
 * Imprime el tenantId, RUC, datos faltantes del emisor, estado actual y los
 * pasos y variables de entorno para activar al negocio. No imprime secretos.
 */
import { closeDatabase, sql } from "../db/client.js";
import { tenantSecretEnvName, tenantUrlEnvName, hasBillingCredential } from "../modules/billing/secretResolver.js";
import { getTenantBillingConfig } from "../modules/billing/tenantBillingConfigRepository.js";

const email = process.argv[2]?.trim().toLowerCase();
const provider = (process.argv[3]?.trim().toLowerCase() || "apisperu") as "apisperu" | "nubefact";
if (!email || !["apisperu", "nubefact"].includes(provider)) {
  console.error("Uso: npm run ops:activation -- correo@negocio.pe [apisperu|nubefact]");
  process.exit(1);
}

const rows = await sql<{ tenant_id: string; ruc: string | null; business_name: string | null; address: string | null; ubigeo: string | null; role: string }[]>`
  select m.tenant_id, t.ruc, t.legal_name as business_name, t.address, t.ubigeo, m.role
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
  const missing = [
    !row.ruc && "RUC",
    !row.business_name && "razón social",
    !row.address && "dirección fiscal",
    !row.ubigeo && "ubigeo"
  ].filter(Boolean);
  console.log(`
Negocio:     ${row.business_name ?? "(sin razón social)"}  RUC ${row.ruc ?? "(sin RUC)"}  [${row.role}]
tenantId:    ${row.tenant_id}
Proveedor:   ${config.providerCode} (${config.environment})  credencial configurada: ${hasBillingCredential(config) ? "sí" : "no"}
${missing.length ? `ATENCIÓN: faltan datos del emisor (${missing.join(", ")}). Complétalos en la app (Configuración → Datos de empresa) antes de activar.\n` : ""}`);

  if (provider === "apisperu") {
    console.log(`Pasos APIsPERU:
  1. El negocio crea en SUNAT SOL un usuario SECUNDARIO solo con permiso de emisión electrónica
     (nunca usamos su Clave SOL principal; puede desactivarlo cuando quiera).
  2. Registra la empresa en el panel de APIsPERU (o POST /companies) con ese usuario secundario,
     su certificado digital (PEM base64) y entorno "beta" para las pruebas.
  3. Copia el TOKEN de esa empresa y defínelo en el gestor de secretos del servidor:
       ${tenantSecretEnvName(row.tenant_id)}=<token de la empresa en APIsPERU>
  4. Reinicia la API y ejecuta:
       update tenant_billing_settings set provider_code = 'apisperu', environment = 'sandbox' where tenant_id = '${row.tenant_id}';
  5. En la app: Configuración → Facturación → probar conexión; emite una boleta beta de S/ 1.
  Producción: cambia la empresa a "produccion" en APIsPERU, define BILLING_PRODUCTION_ENABLED=true y environment = 'production'.`);
  } else {
    console.log(`Pasos Nubefact:
  1. Crea la cuenta del negocio en Nubefact (reseller) con las series B001, F001, BC01, FC01.
  2. Define en el gestor de secretos del servidor:
       ${tenantUrlEnvName(row.tenant_id)}=<RUTA de la cuenta Nubefact del negocio>
       ${tenantSecretEnvName(row.tenant_id)}=<TOKEN de esa cuenta>
  3. Reinicia la API y ejecuta:
       update tenant_billing_settings set provider_code = 'nubefact', environment = 'sandbox' where tenant_id = '${row.tenant_id}';
  Producción: tras la homologación, BILLING_PRODUCTION_ENABLED=true y environment = 'production'.`);
  }
}
await closeDatabase();
