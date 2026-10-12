import { randomUUID } from "node:crypto";
import { sql } from "../../db/client.js";

export type ProductRecord = {
  id: string;
  clientProductId: string;
  name: string;
  unitPrice: number;
  unitCode: string;
  favorite: boolean;
  sku?: string;
};

type ProductRow = {
  id: string;
  client_product_id: string;
  name: string;
  unit_price: string | number;
  unit_code: string;
  favorite: boolean;
  sku: string | null;
};

function mapProduct(row: ProductRow): ProductRecord {
  return {
    id: row.id,
    clientProductId: row.client_product_id,
    name: row.name,
    unitPrice: Number(row.unit_price),
    unitCode: row.unit_code,
    favorite: row.favorite,
    sku: row.sku ?? undefined
  };
}

export async function listProducts(tenantId: string): Promise<ProductRecord[]> {
  const rows = await sql<ProductRow[]>`
    select id, client_product_id, name, unit_price, unit_code, favorite, sku
    from products
    where tenant_id = ${tenantId} and active = true
    order by favorite desc, lower(name) asc
  `;
  return rows.map(mapProduct);
}

export async function upsertProduct(input: {
  tenantId: string;
  clientProductId: string;
  name: string;
  unitPrice: number;
  unitCode?: string;
  favorite?: boolean;
  sku?: string;
}): Promise<ProductRecord> {
  const rows = await sql<ProductRow[]>`
    insert into products (
      id, tenant_id, client_product_id, name, unit_price, unit_code, favorite, sku
    ) values (
      ${randomUUID()}, ${input.tenantId}, ${input.clientProductId}, ${input.name}, ${input.unitPrice},
      ${input.unitCode ?? "NIU"}, ${input.favorite ?? false}, ${input.sku ?? null}
    )
    on conflict (tenant_id, client_product_id)
    do update set
      name = excluded.name,
      unit_price = excluded.unit_price,
      unit_code = excluded.unit_code,
      favorite = excluded.favorite,
      sku = coalesce(excluded.sku, products.sku),
      active = true,
      updated_at = now()
    returning id, client_product_id, name, unit_price, unit_code, favorite, sku
  `;
  return mapProduct(rows[0]);
}
