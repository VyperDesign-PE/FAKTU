import { randomUUID } from "node:crypto";
import { sql } from "../../db/client.js";

export async function recordDocumentLookup(input: {
  tenantId: string;
  documentType: "DNI" | "RUC";
  documentNumber: string;
  lookupSource: string;
  providerCode?: string;
  externalLookup: boolean;
  estimatedCost: number;
  successful: boolean;
}) {
  await sql`
    insert into document_lookup_usage (
      id, tenant_id, document_type, document_number, lookup_source,
      provider_code, external_lookup, estimated_cost, successful
    ) values (
      ${randomUUID()}, ${input.tenantId}, ${input.documentType}, ${input.documentNumber}, ${input.lookupSource},
      ${input.providerCode ?? null}, ${input.externalLookup}, ${input.estimatedCost}, ${input.successful}
    )
  `;
}

export async function getMonthlyLookupSummary(tenantId: string) {
  const rows = await sql<{
    total_lookups: number;
    external_lookups: number;
    cache_hits: number;
    estimated_cost: string;
  }[]>`
    select
      count(*)::int as total_lookups,
      count(*) filter (where external_lookup = true)::int as external_lookups,
      count(*) filter (where external_lookup = false)::int as cache_hits,
      coalesce(sum(estimated_cost), 0)::text as estimated_cost
    from document_lookup_usage
    where tenant_id = ${tenantId}
      and created_at >= date_trunc('month', now())
      and created_at < date_trunc('month', now()) + interval '1 month'
  `;
  const row = rows[0];
  return {
    totalLookups: row?.total_lookups ?? 0,
    externalLookups: row?.external_lookups ?? 0,
    cacheHits: row?.cache_hits ?? 0,
    estimatedCost: Number(row?.estimated_cost ?? 0)
  };
}
