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
  /** null = sin control de inventario. */
  stockQty: number | null;
  minStock: number;
};

type ProductRow = {
  id: string;
  client_product_id: string;
  name: string;
  unit_price: string | number;
  unit_code: string;
  favorite: boolean;
  sku: string | null;
  stock_qty: string | number | null;
  min_stock: string | number;
};

function mapProduct(row: ProductRow): ProductRecord {
  return {
    id: row.id,
    clientProductId: row.client_product_id,
    name: row.name,
    unitPrice: Number(row.unit_price),
    unitCode: row.unit_code,
    favorite: row.favorite,
    sku: row.sku ?? undefined,
    stockQty: row.stock_qty === null ? null : Number(row.stock_qty),
    minStock: Number(row.min_stock)
  };
}

export async function listProducts(tenantId: string): Promise<ProductRecord[]> {
  const rows = await sql<ProductRow[]>`
    select id, client_product_id, name, unit_price, unit_code, favorite, sku, stock_qty, min_stock
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
  minStock?: number;
}): Promise<ProductRecord> {
  const rows = await sql<ProductRow[]>`
    insert into products (
      id, tenant_id, client_product_id, name, unit_price, unit_code, favorite, sku, min_stock
    ) values (
      ${randomUUID()}, ${input.tenantId}, ${input.clientProductId}, ${input.name}, ${input.unitPrice},
      ${input.unitCode ?? "NIU"}, ${input.favorite ?? false}, ${input.sku ?? null}, ${input.minStock ?? 0}
    )
    on conflict (tenant_id, client_product_id)
    do update set
      name = excluded.name,
      unit_price = excluded.unit_price,
      unit_code = excluded.unit_code,
      favorite = excluded.favorite,
      sku = coalesce(excluded.sku, products.sku),
      min_stock = case when ${input.minStock === undefined} then products.min_stock else excluded.min_stock end,
      active = true,
      updated_at = now()
    returning id, client_product_id, name, unit_price, unit_code, favorite, sku, stock_qty, min_stock
  `;
  return mapProduct(rows[0]);
}

export async function archiveProduct(tenantId: string, clientProductId: string) {
  await sql`update products set active = false, updated_at = now() where tenant_id = ${tenantId} and client_product_id = ${clientProductId}`;
}
