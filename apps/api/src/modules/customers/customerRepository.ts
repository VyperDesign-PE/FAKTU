import { randomUUID } from "node:crypto";
import { sql } from "../../db/client.js";

export type CustomerRecord = {
  id: string;
  tenantId: string;
  documentType: "DNI" | "RUC";
  documentNumber: string;
  fullName: string;
  address?: string;
  phone?: string;
  email?: string;
  dataSource: string;
  verifiedAt?: string;
};

type CustomerRow = {
  id: string;
  tenant_id: string;
  document_type: "DNI" | "RUC";
  document_number: string;
  full_name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  data_source: string;
  verified_at: Date | string | null;
};

function mapCustomer(row: CustomerRow): CustomerRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    documentType: row.document_type,
    documentNumber: row.document_number,
    fullName: row.full_name,
    address: row.address ?? undefined,
    phone: row.phone ?? undefined,
    email: row.email ?? undefined,
    dataSource: row.data_source,
    verifiedAt: row.verified_at ? new Date(row.verified_at).toISOString() : undefined
  };
}

export async function findCustomerByDocument(
  tenantId: string,
  documentType: "DNI" | "RUC",
  documentNumber: string
): Promise<CustomerRecord | null> {
  const rows = await sql<CustomerRow[]>`
    select id, tenant_id, document_type, document_number, full_name, address, phone, email, data_source, verified_at
    from customers
    where tenant_id = ${tenantId}
      and document_type = ${documentType}
      and document_number = ${documentNumber}
      and active = true
    limit 1
  `;
  return rows[0] ? mapCustomer(rows[0]) : null;
}

export async function getCustomerById(tenantId: string, id: string): Promise<CustomerRecord | null> {
  const rows = await sql<CustomerRow[]>`
    select id, tenant_id, document_type, document_number, full_name, address, phone, email, data_source, verified_at
    from customers
    where tenant_id = ${tenantId} and id = ${id} and active = true
    limit 1
  `;
  return rows[0] ? mapCustomer(rows[0]) : null;
}

export async function upsertCustomer(input: {
  tenantId: string;
  documentType: "DNI" | "RUC";
  documentNumber: string;
  fullName: string;
  address?: string;
  phone?: string;
  email?: string;
  dataSource: string;
  verifiedAt?: Date;
}): Promise<CustomerRecord> {
  const id = randomUUID();
  const rows = await sql<CustomerRow[]>`
    insert into customers (
      id, tenant_id, document_type, document_number, full_name,
      address, phone, email, data_source, verified_at
    ) values (
      ${id}, ${input.tenantId}, ${input.documentType}, ${input.documentNumber}, ${input.fullName},
      ${input.address ?? null}, ${input.phone ?? null}, ${input.email ?? null}, ${input.dataSource}, ${input.verifiedAt ?? null}
    )
    on conflict (tenant_id, document_type, document_number)
    do update set
      full_name = excluded.full_name,
      address = coalesce(excluded.address, customers.address),
      phone = coalesce(excluded.phone, customers.phone),
      email = coalesce(excluded.email, customers.email),
      data_source = case
        when excluded.data_source = 'MANUAL' and customers.data_source <> 'MANUAL' then customers.data_source
        else excluded.data_source
      end,
      verified_at = coalesce(excluded.verified_at, customers.verified_at),
      active = true,
      updated_at = now()
    returning id, tenant_id, document_type, document_number, full_name, address, phone, email, data_source, verified_at
  `;
  return mapCustomer(rows[0]);
}

export async function searchCustomers(tenantId: string, query = "", limit = 50): Promise<CustomerRecord[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const normalized = query.trim();
  const pattern = `%${normalized}%`;
  const rows = normalized
    ? await sql<CustomerRow[]>`
        select id, tenant_id, document_type, document_number, full_name, address, phone, email, data_source, verified_at
        from customers
        where tenant_id = ${tenantId}
          and active = true
          and (document_number ilike ${pattern} or full_name ilike ${pattern})
        order by full_name asc
        limit ${safeLimit}
      `
    : await sql<CustomerRow[]>`
        select id, tenant_id, document_type, document_number, full_name, address, phone, email, data_source, verified_at
        from customers
        where tenant_id = ${tenantId} and active = true
        order by updated_at desc
        limit ${safeLimit}
      `;
  return rows.map(mapCustomer);
}
