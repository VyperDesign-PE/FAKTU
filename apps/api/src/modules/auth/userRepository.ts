import { randomUUID } from "node:crypto";
import { sql } from "../../db/client.js";

export type UserRecord = {
  id: string;
  email: string;
  passwordHash: string;
  tenantId: string;
};

type UserRow = { id: string; email: string; password_hash: string; tenant_id?: string };

function mapUser(row: UserRow, tenantId: string): UserRecord {
  return { id: row.id, email: row.email, passwordHash: row.password_hash, tenantId };
}

async function ensureDefaultTenant(user: Pick<UserRow, "id" | "email">): Promise<string> {
  const memberships = await sql`
    select tenant_id
    from tenant_memberships
    where user_id = ${user.id}
    order by created_at asc
    limit 1
  `;
  const existing = memberships[0] as { tenant_id: string } | undefined;
  if (existing) return existing.tenant_id;

  const tenantId = randomUUID();
  await sql.begin(async (tx) => {
    await tx`
      insert into tenants (id, display_name)
      values (${tenantId}, ${`Negocio de ${user.email}`})
      on conflict do nothing
    `;
    await tx`
      insert into tenant_memberships (tenant_id, user_id, role)
      values (${tenantId}, ${user.id}, 'OWNER')
      on conflict do nothing
    `;
    await tx`
      insert into subscriptions (tenant_id, plan_code, status, trial_ends_at)
      values (${tenantId}, 'MVP', 'TRIALING', now() + interval '30 days')
      on conflict do nothing
    `;
    await tx`
      insert into tenant_billing_settings (tenant_id, provider_code, environment)
      values (${tenantId}, 'mock', 'sandbox')
      on conflict do nothing
    `;
  });
  return tenantId;
}

export async function findUserByEmail(email: string): Promise<UserRecord | null> {
  const rows = await sql`
    select id, email, password_hash
    from app_users
    where email = ${email}
    limit 1
  `;
  const row = rows[0] as UserRow | undefined;
  if (!row) return null;
  return mapUser(row, await ensureDefaultTenant(row));
}

export async function findUserById(id: string): Promise<UserRecord | null> {
  const rows = await sql`
    select id, email, password_hash
    from app_users
    where id = ${id}
    limit 1
  `;
  const row = rows[0] as UserRow | undefined;
  if (!row) return null;
  return mapUser(row, await ensureDefaultTenant(row));
}

export async function createUser(email: string, passwordHash: string): Promise<UserRecord | null> {
  const id = randomUUID();
  const tenantId = randomUUID();

  try {
    await sql.begin(async (tx) => {
      await tx`
        insert into app_users (id, email, password_hash)
        values (${id}, ${email}, ${passwordHash})
      `;
      await tx`
        insert into tenants (id, display_name)
        values (${tenantId}, ${`Negocio de ${email}`})
      `;
      await tx`
        insert into tenant_memberships (tenant_id, user_id, role)
        values (${tenantId}, ${id}, 'OWNER')
      `;
      await tx`
        insert into subscriptions (tenant_id, plan_code, status, trial_ends_at)
        values (${tenantId}, 'MVP', 'TRIALING', now() + interval '30 days')
      `;
      await tx`
        insert into tenant_billing_settings (tenant_id, provider_code, environment)
        values (${tenantId}, 'mock', 'sandbox')
      `;
    });
  } catch (error) {
    const pgError = error as { code?: string };
    if (pgError.code === "23505") return null;
    throw error;
  }

  return { id, email, passwordHash, tenantId };
}
