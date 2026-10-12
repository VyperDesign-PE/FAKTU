import { randomUUID } from "node:crypto";
import { sql } from "../../db/client.js";
import type { SunatRucImportRow } from "./sunatRucParser.js";

export type SunatRucRecord = {
  ruc: string;
  legalName: string;
  taxpayerStatus?: string;
  domicileCondition?: string;
  ubigeo?: string;
  fiscalAddress?: string;
  sourceUpdatedAt?: string;
};


type SunatRucRow = {
  ruc: string;
  legal_name: string;
  taxpayer_status: string | null;
  domicile_condition: string | null;
  ubigeo: string | null;
  fiscal_address: string | null;
  source_updated_at: Date | string | null;
};

function mapRow(row: SunatRucRow): SunatRucRecord {
  return {
    ruc: row.ruc,
    legalName: row.legal_name,
    taxpayerStatus: row.taxpayer_status ?? undefined,
    domicileCondition: row.domicile_condition ?? undefined,
    ubigeo: row.ubigeo ?? undefined,
    fiscalAddress: row.fiscal_address ?? undefined,
    sourceUpdatedAt: row.source_updated_at
      ? new Date(row.source_updated_at).toISOString().slice(0, 10)
      : undefined
  };
}

export async function findSunatRuc(ruc: string): Promise<SunatRucRecord | null> {
  const rows = await sql<SunatRucRow[]>`
    select ruc, legal_name, taxpayer_status, domicile_condition, ubigeo, fiscal_address, source_updated_at
    from sunat_ruc_registry
    where ruc = ${ruc}
    limit 1
  `;
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function getSunatRucRegistryStatus() {
  const completed = await sql<{
    row_count: number;
    source_updated_at: Date | string | null;
    completed_at: Date | string | null;
  }[]>`
    select row_count::int, source_updated_at, completed_at
    from sunat_ruc_import_runs
    where status = 'COMPLETED'
    order by completed_at desc nulls last
    limit 1
  `;

  const lastRun = await sql<{
    id: string;
    status: "RUNNING" | "COMPLETED" | "FAILED";
    row_count: number;
    source_url: string;
    source_updated_at: Date | string | null;
    source_sha256: string | null;
    started_at: Date | string;
    completed_at: Date | string | null;
    error_message: string | null;
  }[]>`
    select id, status, row_count::int, source_url, source_updated_at, source_sha256, started_at, completed_at, error_message
    from sunat_ruc_import_runs
    order by started_at desc
    limit 1
  `;

  const good = completed[0];
  const run = lastRun[0];
  return {
    rowCount: good?.row_count ?? 0,
    sourceUpdatedAt: good?.source_updated_at
      ? new Date(good.source_updated_at).toISOString().slice(0, 10)
      : undefined,
    importedAt: good?.completed_at ? new Date(good.completed_at).toISOString() : undefined,
    ready: Boolean(good && good.row_count > 0),
    lastRun: run
      ? {
          id: run.id,
          status: run.status,
          rowCount: run.row_count,
          sourceUrl: run.source_url,
          sourceUpdatedAt: run.source_updated_at
            ? new Date(run.source_updated_at).toISOString().slice(0, 10)
            : undefined,
          sourceSha256: run.source_sha256 ?? undefined,
          startedAt: new Date(run.started_at).toISOString(),
          completedAt: run.completed_at ? new Date(run.completed_at).toISOString() : undefined,
          errorMessage: run.error_message ?? undefined
        }
      : undefined
  };
}

export async function startSunatRucImport(input: {
  sourceUrl: string;
  sourceUpdatedAt?: string;
  sourceSha256?: string;
}) {
  const runId = randomUUID();
  await sql`
    insert into sunat_ruc_import_runs (id, source_url, source_updated_at, source_sha256, status)
    values (${runId}, ${input.sourceUrl}, ${input.sourceUpdatedAt ?? null}, ${input.sourceSha256 ?? null}, 'RUNNING')
  `;
  return runId;
}

/**
 * Upsert por lotes directamente al índice final.
 * Evita duplicar varios GB de datos en staging. No se eliminan filas antiguas hasta
 * que el archivo completo haya pasado las validaciones de cantidad/esquema.
 */
export async function upsertSunatRucRows(input: {
  runId: string;
  sourceUpdatedAt?: string;
  rows: SunatRucImportRow[];
}) {
  if (!input.rows.length) return;

  const values = input.rows.map((row) => ({
    ruc: row.ruc,
    legal_name: row.legalName,
    taxpayer_status: row.taxpayerStatus ?? null,
    domicile_condition: row.domicileCondition ?? null,
    ubigeo: row.ubigeo ?? null,
    fiscal_address: row.fiscalAddress ?? null,
    data_version: input.runId,
    source_updated_at: input.sourceUpdatedAt ?? null
  }));

  await sql`
    insert into sunat_ruc_registry ${sql(
      values,
      "ruc",
      "legal_name",
      "taxpayer_status",
      "domicile_condition",
      "ubigeo",
      "fiscal_address",
      "data_version",
      "source_updated_at"
    )}
    on conflict (ruc) do update set
      legal_name = excluded.legal_name,
      taxpayer_status = excluded.taxpayer_status,
      domicile_condition = excluded.domicile_condition,
      ubigeo = excluded.ubigeo,
      fiscal_address = excluded.fiscal_address,
      data_version = excluded.data_version,
      source_updated_at = excluded.source_updated_at,
      imported_at = now(),
      updated_at = now()
  `;
}

export async function completeSunatRucImport(input: {
  runId: string;
  rowCount: number;
  pruneMissing: boolean;
}) {
  await sql.begin(async (tx) => {
    if (input.pruneMissing) {
      await tx`
        delete from sunat_ruc_registry
        where data_version <> ${input.runId}
      `;
    }

    await tx`
      update sunat_ruc_import_runs
      set status = 'COMPLETED', row_count = ${input.rowCount}, completed_at = now(), error_message = null
      where id = ${input.runId}
    `;
  });
}

export async function failSunatRucImport(runId: string, errorMessage: string, rowCount = 0) {
  await sql`
    update sunat_ruc_import_runs
    set status = 'FAILED', row_count = ${rowCount}, error_message = ${errorMessage.slice(0, 4000)}, completed_at = now()
    where id = ${runId}
  `;
}
