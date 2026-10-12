/**
 * Guarda (cifrado) el token o la URL de proveedor de un negocio en la bóveda.
 *
 *   echo -n "TOKEN" | npm run ops:secret -- correo@negocio.pe token
 *   echo -n "https://api.nubefact.com/api/v1/..." | npm run ops:secret -- correo@negocio.pe url
 *
 * El valor se lee por entrada estándar: no queda en el historial de la terminal.
 */
import { closeDatabase, sql } from "../db/client.js";
import { runMigrations } from "../db/migrations.js";
import { audit } from "../modules/security/audit.js";
import { setTenantSecret } from "../modules/security/vault.js";

const [identifier, kindArg] = process.argv.slice(2);
const kind = kindArg === "url" ? "billing_url" : kindArg === "token" ? "billing_token" : undefined;

async function readStdin() {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8").trim();
}

async function main() {
  if (!identifier || !kind) throw new Error("Uso: echo -n VALOR | npm run ops:secret -- <correo|tenantId> <token|url>");
  const value = await readStdin();
  if (!value) throw new Error("No recibí ningún valor por entrada estándar.");
  await runMigrations();
  const rows = await sql<{ tenant_id: string }[]>`
    select m.tenant_id from tenant_memberships m join app_users u on u.id = m.user_id where u.email = ${identifier.toLowerCase()} or m.tenant_id::text = ${identifier} limit 1
  `;
  const tenantId = rows[0]?.tenant_id;
  if (!tenantId) throw new Error("No encontré ese negocio.");
  await setTenantSecret(tenantId, kind!, value);
  await audit({ tenantId, action: "SECRET_SET", entityType: "tenant", entityId: tenantId, meta: { kind } });
  console.log(`Guardado (cifrado) ${kindArg} para el negocio ${tenantId}.`);
}

main()
  .catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; })
  .finally(() => closeDatabase().catch(() => undefined));
