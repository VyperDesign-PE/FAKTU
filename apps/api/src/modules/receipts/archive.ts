import { sql } from "../../db/client.js";

/**
 * Archivo propio de XML y CDR (SUNAT exige conservar los comprobantes por 5 años).
 * Los proveedores que solo devuelven un enlace (Nubefact) dejan el archivo en su
 * servidor; aquí se descarga y se guarda en nuestra base para no depender de
 * que el enlace siga vivo ni del contrato con el proveedor.
 */
const MAX_BYTES = 5 * 1024 * 1024;

async function download(url: string): Promise<Buffer | undefined> {
  if (!/^https:\/\//i.test(url)) return undefined;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000), redirect: "follow" });
    if (!response.ok) return undefined;
    const bytes = Buffer.from(await response.arrayBuffer());
    return bytes.length > 0 && bytes.length <= MAX_BYTES ? bytes : undefined;
  } catch {
    return undefined;
  }
}

export async function archivePendingFiles(limit = 20) {
  const rows = await sql<{ id: string; provider_code: string | null; provider_xml_url: string | null; provider_cdr_url: string | null; has_xml: boolean; has_cdr: boolean }[]>`
    select r.id, r.provider_code, r.provider_xml_url, r.provider_cdr_url,
           (a.xml_content is not null) as has_xml, (a.cdr_zip_base64 is not null) as has_cdr
    from receipts r
    left join receipt_provider_artifacts a on a.receipt_id = r.id
    where r.sunat_status = 'ACEPTADO' and r.is_practice = false
      and r.updated_at > now() - interval '30 days'
      and ((r.provider_xml_url is not null and a.xml_content is null)
        or (r.provider_cdr_url is not null and a.cdr_zip_base64 is null))
    order by r.updated_at desc
    limit ${limit}
  `;
  let archived = 0;
  for (const row of rows) {
    const xml = row.provider_xml_url && !row.has_xml ? await download(row.provider_xml_url) : undefined;
    const cdr = row.provider_cdr_url && !row.has_cdr ? await download(row.provider_cdr_url) : undefined;
    if (!xml && !cdr) continue;
    await sql`
      insert into receipt_provider_artifacts (receipt_id, provider_code, xml_content, cdr_zip_base64, updated_at)
      values (${row.id}, ${row.provider_code ?? "unknown"}, ${xml ? xml.toString("utf8") : null}, ${cdr ? cdr.toString("base64") : null}, now())
      on conflict (receipt_id) do update set
        xml_content = coalesce(receipt_provider_artifacts.xml_content, excluded.xml_content),
        cdr_zip_base64 = coalesce(receipt_provider_artifacts.cdr_zip_base64, excluded.cdr_zip_base64),
        updated_at = now()
    `;
    archived += 1;
  }
  return archived;
}

/** Archivo guardado de un comprobante del negocio (para descargarlo o entregarlo al contador). */
export async function getArchivedFile(tenantId: string, receiptId: string, kind: "xml" | "cdr") {
  const rows = await sql<{ xml_content: string | null; cdr_zip_base64: string | null; official_number: string | null; series: string; correlative: string | number }[]>`
    select a.xml_content, a.cdr_zip_base64, r.official_number, r.series, r.correlative
    from receipt_provider_artifacts a join receipts r on r.id = a.receipt_id
    where r.id = ${receiptId} and r.tenant_id = ${tenantId}
  `;
  const row = rows[0];
  if (!row) return undefined;
  const base = row.official_number ?? `${row.series}-${String(row.correlative).padStart(8, "0")}`;
  if (kind === "xml" && row.xml_content) return { filename: `${base}.xml`, contentType: "application/xml", body: Buffer.from(row.xml_content, "utf8") };
  if (kind === "cdr" && row.cdr_zip_base64) return { filename: `R-${base}.zip`, contentType: "application/zip", body: Buffer.from(row.cdr_zip_base64, "base64") };
  return undefined;
}
