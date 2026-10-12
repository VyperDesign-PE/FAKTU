import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { sql } from "../../db/client.js";

/**
 * Bóveda de secretos: cifrado AES-256-GCM con la clave maestra del servidor.
 *
 * - La clave maestra (SECRETS_MASTER_KEY, 32 bytes en hex o base64) vive fuera
 *   de la base de datos: quien robe un respaldo de la base no obtiene tokens.
 * - Cada valor se cifra con IV aleatorio y se "ata" a su dueño (AAD): un
 *   secreto copiado a otro negocio o usuario no descifra.
 * - Para operar con un gestor externo (AWS KMS, GCP KMS, Vault) basta con
 *   reemplazar `masterKey()` conservando la interfaz.
 */
let cachedKey: Buffer | undefined;

function masterKey(): Buffer {
  if (cachedKey) return cachedKey;
  const configured = process.env.SECRETS_MASTER_KEY?.trim();
  if (configured) {
    const raw = /^[0-9a-fA-F]{64}$/.test(configured) ? Buffer.from(configured, "hex") : Buffer.from(configured, "base64");
    if (raw.length !== 32) throw new Error("SECRETS_MASTER_KEY debe tener 32 bytes (64 caracteres hex o base64).");
    cachedKey = raw;
    return raw;
  }
  if (process.env.NODE_ENV === "production" && (process.env.ALLOW_DERIVED_SECRETS_KEY ?? "false").toLowerCase() !== "true") {
    throw new Error("SECRETS_MASTER_KEY es obligatorio en producción (openssl rand -hex 32).");
  }
  // Solo desarrollo/demo: clave derivada del JWT_SECRET.
  const base = process.env.JWT_SECRET ?? "dev-only-change-me-before-production";
  cachedKey = Buffer.from(hkdfSync("sha256", base, "faktu-vault", "secrets-v1", 32));
  return cachedKey;
}

export function encryptSecret(plain: string, aad: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  cipher.setAAD(Buffer.from(aad));
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v1.${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64")}`;
}

export function decryptSecret(payload: string, aad: string): string {
  if (!payload.startsWith("v1.")) throw new Error("Formato de secreto desconocido");
  const raw = Buffer.from(payload.slice(3), "base64");
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), raw.subarray(0, 12));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}

export type TenantSecretKind = "billing_token" | "billing_url";

export async function setTenantSecret(tenantId: string, kind: TenantSecretKind, value: string) {
  const ciphertext = encryptSecret(value, `${tenantId}:${kind}`);
  await sql`
    insert into tenant_secrets (tenant_id, kind, ciphertext) values (${tenantId}, ${kind}, ${ciphertext})
    on conflict (tenant_id, kind) do update set ciphertext = excluded.ciphertext, updated_at = now()
  `;
  const cache = secretCache.get(tenantId) ?? {};
  cache[kind] = value;
  secretCache.set(tenantId, cache);
}

// La resolución de credenciales es síncrona en toda la app: la bóveda se carga
// en memoria al iniciar y se refresca periódicamente (los valores viven solo en RAM).
const secretCache = new Map<string, Partial<Record<TenantSecretKind, string>>>();

export function getCachedTenantSecret(tenantId: string, kind: TenantSecretKind): string | undefined {
  return secretCache.get(tenantId)?.[kind];
}

export async function loadSecretCache() {
  const rows = await sql<{ tenant_id: string; kind: TenantSecretKind; ciphertext: string }[]>`select tenant_id, kind, ciphertext from tenant_secrets`;
  const next = new Map<string, Partial<Record<TenantSecretKind, string>>>();
  for (const row of rows) {
    try {
      const entry = next.get(row.tenant_id) ?? {};
      entry[row.kind] = decryptSecret(row.ciphertext, `${row.tenant_id}:${row.kind}`);
      next.set(row.tenant_id, entry);
    } catch {
      // Secreto corrupto o clave incorrecta: ese negocio quedará sin credencial (falla cerrado).
    }
  }
  secretCache.clear();
  for (const [key, value] of next) secretCache.set(key, value);
  return secretCache.size;
}

export function startSecretCacheRefresh(intervalMs = 60_000) {
  void loadSecretCache().catch(() => undefined);
  const timer = setInterval(() => void loadSecretCache().catch(() => undefined), intervalMs);
  timer.unref();
}
