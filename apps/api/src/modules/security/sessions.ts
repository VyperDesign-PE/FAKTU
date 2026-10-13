import { createHash, randomBytes, randomUUID } from "node:crypto";
import { sql } from "../../db/client.js";

/**
 * Sesiones con token de renovación rotativo.
 *
 * - El token de acceso (JWT) dura poco (ACCESS_TOKEN_TTL, 15 min por defecto) y
 *   lleva el id de sesión (`sid`): cerrar sesión lo invalida al instante.
 * - El token de renovación dura REFRESH_TOKEN_DAYS (30) y cambia en cada uso.
 *   En la base solo se guarda su hash SHA-256.
 * - Si alguien presenta un token de renovación ya usado, se revoca toda la
 *   familia de sesiones de ese dispositivo (el token fue copiado o robado).
 */
const REFRESH_DAYS = Number(process.env.REFRESH_TOKEN_DAYS ?? 30);
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export class SessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionError";
  }
}

export async function createSession(userId: string, meta: { userAgent?: string; ip?: string } = {}, familyId = randomUUID()) {
  const id = randomUUID();
  const refreshToken = randomBytes(32).toString("base64url");
  await sql`
    insert into auth_sessions (id, user_id, family_id, token_hash, expires_at, user_agent, ip)
    values (${id}, ${userId}, ${familyId}, ${hash(refreshToken)}, now() + make_interval(days => ${REFRESH_DAYS}),
            ${meta.userAgent?.slice(0, 200) ?? null}, ${meta.ip ?? null})
  `;
  return { sessionId: id, refreshToken };
}

/** Rota el token: devuelve una sesión nueva de la misma familia. */
export async function rotateSession(refreshToken: string, meta: { userAgent?: string; ip?: string } = {}) {
  const outcome = await sql.begin(async (tx) => {
    const rows = await tx<{ id: string; user_id: string; family_id: string; expires_at: Date; revoked_at: Date | null; replaced_by: string | null }[]>`
      select id, user_id, family_id, expires_at, revoked_at, replaced_by from auth_sessions
      where token_hash = ${hash(refreshToken)} for update
    `;
    const current = rows[0];
    if (!current) throw new SessionError("Tu sesión venció. Ingresa nuevamente.");
    // Reuso de un token ya rotado: se revoca todo el dispositivo (fuera de esta
    // transacción, para que la revocación no se deshaga al lanzar el error).
    if (current.revoked_at || current.replaced_by) return { reusedFamily: current.family_id };
    if (current.expires_at.getTime() < Date.now()) throw new SessionError("Tu sesión venció. Ingresa nuevamente.");
    const id = randomUUID();
    const next = randomBytes(32).toString("base64url");
    await tx`
      insert into auth_sessions (id, user_id, family_id, token_hash, expires_at, user_agent, ip)
      values (${id}, ${current.user_id}, ${current.family_id}, ${hash(next)}, now() + make_interval(days => ${REFRESH_DAYS}),
              ${meta.userAgent?.slice(0, 200) ?? null}, ${meta.ip ?? null})
    `;
    await tx`update auth_sessions set replaced_by = ${id}, revoked_at = now(), last_used_at = now() where id = ${current.id}`;
    return { userId: current.user_id, sessionId: id, refreshToken: next };
  });
  if ("reusedFamily" in outcome) {
    await sql`update auth_sessions set revoked_at = coalesce(revoked_at, now()) where family_id = ${outcome.reusedFamily as string}`;
    throw new SessionError("Por seguridad cerramos tu sesión. Ingresa nuevamente.");
  }
  return outcome;
}

/** Una sesión está vigente si existe, no fue revocada y no venció. */
export async function isSessionActive(sessionId: string) {
  const rows = await sql<{ ok: boolean }[]>`
    select (revoked_at is null and expires_at > now()) as ok from auth_sessions where id = ${sessionId}
  `;
  return rows[0]?.ok === true;
}

export async function revokeSessionFamily(sessionId: string) {
  await sql`
    update auth_sessions set revoked_at = coalesce(revoked_at, now())
    where family_id = (select family_id from auth_sessions where id = ${sessionId})
  `;
}

export async function revokeAllUserSessions(userId: string) {
  await sql`update auth_sessions set revoked_at = coalesce(revoked_at, now()) where user_id = ${userId}`;
}

export async function listActiveSessions(userId: string) {
  const rows = await sql<{ family_id: string; user_agent: string | null; ip: string | null; created_at: Date; last_used_at: Date }[]>`
    select distinct on (family_id) family_id, user_agent, ip, created_at, last_used_at
    from auth_sessions where user_id = ${userId} and revoked_at is null and expires_at > now()
    order by family_id, created_at desc
  `;
  return rows.map((row) => ({ device: row.user_agent ?? "Dispositivo", ip: row.ip ?? undefined, lastUsedAt: row.last_used_at.toISOString() }));
}
