import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { sql } from "../../db/client.js";
import { decryptSecret, encryptSecret } from "./vault.js";

/** Verificación en dos pasos TOTP (RFC 6238), compatible con Google Authenticator, Authy y 1Password. */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buffer: Buffer) {
  let bits = 0, value = 0, output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { output += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(text: string) {
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const char of text.replace(/=+$/, "").toUpperCase()) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) continue;
    value = (value << 5) | index; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export function totpCode(secret: string, atMs = Date.now()) {
  const counter = Math.floor(atMs / 30_000);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", base32Decode(secret)).update(message).digest();
  const offset = hmac[hmac.length - 1] & 15;
  const binary = ((hmac[offset] & 127) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(binary % 1_000_000).padStart(6, "0");
}

export function verifyTotp(secret: string, code: string, atMs = Date.now()) {
  if (!/^\d{6}$/.test(code)) return false;
  for (const drift of [-1, 0, 1]) {
    const expected = Buffer.from(totpCode(secret, atMs + drift * 30_000));
    if (timingSafeEqual(expected, Buffer.from(code))) return true;
  }
  return false;
}

export function generateTotpSecret() {
  return base32Encode(randomBytes(20));
}

export function otpauthUrl(email: string, secret: string) {
  return `otpauth://totp/Faktu:${encodeURIComponent(email)}?secret=${secret}&issuer=Faktu&algorithm=SHA1&digits=6&period=30`;
}

export async function startMfaSetup(userId: string, secret: string) {
  await sql`
    insert into user_mfa (user_id, secret_ciphertext, enabled) values (${userId}, ${encryptSecret(secret, `mfa:${userId}`)}, false)
    on conflict (user_id) do update set secret_ciphertext = excluded.secret_ciphertext, enabled = false, created_at = now()
  `;
}

async function readMfa(userId: string) {
  const rows = await sql<{ secret_ciphertext: string; enabled: boolean }[]>`select secret_ciphertext, enabled from user_mfa where user_id = ${userId}`;
  if (!rows[0]) return undefined;
  return { secret: decryptSecret(rows[0].secret_ciphertext, `mfa:${userId}`), enabled: rows[0].enabled };
}

export async function isMfaEnabled(userId: string) {
  return (await readMfa(userId))?.enabled === true;
}

/** Confirma el alta (enabled=true) si el código es válido. */
export async function enableMfa(userId: string, code: string) {
  const mfa = await readMfa(userId);
  if (!mfa || !verifyTotp(mfa.secret, code)) return false;
  await sql`update user_mfa set enabled = true where user_id = ${userId}`;
  return true;
}

export async function checkMfaCode(userId: string, code: string) {
  const mfa = await readMfa(userId);
  return Boolean(mfa?.enabled && verifyTotp(mfa.secret, code));
}

export async function disableMfa(userId: string) {
  await sql`delete from user_mfa where user_id = ${userId}`;
}
