export type SunatRucImportRow = {
  ruc: string;
  legalName: string;
  taxpayerStatus?: string;
  domicileCondition?: string;
  ubigeo?: string;
  fiscalAddress?: string;
};

const ABSENT = new Set(["", "-"]);

function clean(value: string | undefined) {
  const normalized = (value ?? "").replace(/^\uFEFF/, "").trim();
  return ABSENT.has(normalized) ? undefined : normalized;
}

function join(...parts: Array<string | undefined>) {
  return parts.map(clean).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Formato oficial observado del Padrón Reducido RUC:
 * RUC | razón social | estado | condición | ubigeo |
 * tipo vía | nombre vía | código zona | tipo zona | número |
 * interior | lote | departamento | manzana | kilómetro | [vacío final opcional]
 *
 * SUNAT publica el archivo con separador "|" y el ZIP se decodifica como latin-1.
 * El parser es deliberadamente estricto: si cambia el esquema, la ingesta aborta.
 */
export function parseSunatRucLine(line: string): SunatRucImportRow | null {
  const raw = line.replace(/[\r\n]+$/, "");
  if (!raw.trim()) return null;

  const columns = raw.split("|");
  while (columns.length > 15 && clean(columns[columns.length - 1]) === undefined) columns.pop();

  const first = clean(columns[0]);
  if (!first) return null;
  if (first.toUpperCase() === "RUC") return null;

  if (columns.length !== 15) {
    throw new Error(`Formato SUNAT inesperado: se esperaban 15 columnas útiles y llegaron ${columns.length}.`);
  }

  if (!/^\d{11}$/.test(first)) {
    throw new Error(`RUC inválido en padrón: ${first}`);
  }

  const legalName = clean(columns[1]);
  if (!legalName) throw new Error(`Razón social vacía para RUC ${first}.`);

  const typeVia = clean(columns[5]);
  const viaName = clean(columns[6]);
  const zoneCode = clean(columns[7]);
  const zoneType = clean(columns[8]);
  const number = clean(columns[9]);
  const interior = clean(columns[10]);
  const lot = clean(columns[11]);
  const department = clean(columns[12]);
  const block = clean(columns[13]);
  const kilometer = clean(columns[14]);

  const addressParts = [
    join(typeVia, viaName),
    number ? `NRO ${number}` : undefined,
    interior ? `INT ${interior}` : undefined,
    lot ? `LT ${lot}` : undefined,
    department ? `DPTO ${department}` : undefined,
    block ? `MZA ${block}` : undefined,
    kilometer ? `KM ${kilometer}` : undefined,
    join(zoneType, zoneCode)
  ].filter(Boolean);

  return {
    ruc: first,
    legalName,
    taxpayerStatus: clean(columns[2]),
    domicileCondition: clean(columns[3]),
    ubigeo: clean(columns[4]),
    fiscalAddress: addressParts.length ? addressParts.join(" ") : undefined
  };
}
