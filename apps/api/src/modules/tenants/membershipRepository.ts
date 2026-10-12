import { sql } from "../../db/client.js";

export type MembershipRole = "OWNER" | "ADMIN" | "CASHIER" | string;

/** Rol del usuario dentro del negocio activo; null si no pertenece a él. */
export async function getMembershipRole(tenantId: string, userId: string): Promise<MembershipRole | null> {
  const rows = await sql<{ role: string }[]>`
    select role from tenant_memberships
    where tenant_id = ${tenantId} and user_id = ${userId}
    limit 1
  `;
  return rows[0]?.role ?? null;
}
