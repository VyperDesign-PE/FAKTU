import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { StringDecoder } from "node:string_decoder";
import * as readline from "node:readline";
import unzipper from "unzipper";
import { closeDatabase } from "../db/client.js";
import { runMigrations } from "../db/migrations.js";
import { parseSunatRucLine, type SunatRucImportRow } from "../modules/sunatRuc/sunatRucParser.js";
import {
  completeSunatRucImport,
  failSunatRucImport,
  startSunatRucImport,
  upsertSunatRucRows
} from "../modules/sunatRuc/sunatRucRegistryRepository.js";

const DEFAULT_URL = "https://www2.sunat.gob.pe/padron_reducido_ruc.zip";
const DEFAULT_BATCH_SIZE = 5_000;
const DEFAULT_MIN_ROWS = 5_000_000;

type CliOptions = {
  file?: string;
  url: string;
  sourceDate?: string;
  pruneMissing: boolean;
  minRows: number;
  batchSize: number;
};

function boolEnv(name: string, defaultValue: boolean) {
  const raw = process.env[name];
  if (raw == null) return defaultValue;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    url: process.env.SUNAT_RUC_PADRON_URL ?? DEFAULT_URL,
    pruneMissing: boolEnv("SUNAT_RUC_PRUNE_MISSING", true),
    minRows: Number(process.env.SUNAT_RUC_MIN_ROWS ?? DEFAULT_MIN_ROWS),
    batchSize: Number(process.env.SUNAT_RUC_BATCH_SIZE ?? DEFAULT_BATCH_SIZE)
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--file") options.file = argv[++i];
    else if (arg === "--url") options.url = argv[++i];
    else if (arg === "--source-date") options.sourceDate = argv[++i];
    else if (arg === "--no-prune") options.pruneMissing = false;
    else if (arg === "--min-rows") options.minRows = Number(argv[++i]);
    else if (arg === "--batch-size") options.batchSize = Number(argv[++i]);
    else throw new Error(`Argumento no reconocido: ${arg}`);
  }

  if (!Number.isFinite(options.minRows) || options.minRows < 1) throw new Error("--min-rows debe ser mayor a 0.");
  if (!Number.isFinite(options.batchSize) || options.batchSize < 100 || options.batchSize > 8_000) {
    throw new Error("--batch-size debe estar entre 100 y 8000.");
  }
  return options;
}

function dateFromLastModified(value: string | null) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString().slice(0, 10);
}

async function sha256File(path: string) {
  const hash = createHash("sha256");
  const input = createReadStream(path);
  input.on("data", (chunk) => hash.update(chunk));
  await new Promise<void>((resolve, reject) => {
    input.on("end", () => resolve());
    input.on("error", reject);
  });
  return hash.digest("hex");
}

async function downloadZip(url: string) {
  const response = await fetch(url, { headers: { "User-Agent": "facturacion-mvp-ruc-sync/0.10" } });
  if (!response.ok || !response.body) throw new Error(`SUNAT respondió HTTP ${response.status} al descargar el padrón.`);

  const path = join(tmpdir(), `sunat-ruc-${Date.now()}.zip`);
  const input = Readable.fromWeb(response.body as any);
  await pipeline(input, createWriteStream(path));
  return {
    path,
    sha256: await sha256File(path),
    sourceDate: dateFromLastModified(response.headers.get("last-modified"))
  };
}

function latin1DecodeStream() {
  const decoder = new StringDecoder("latin1");
  return new Transform({
    transform(chunk, _encoding, callback) {
      callback(null, decoder.write(chunk as Buffer));
    },
    flush(callback) {
      const rest = decoder.end();
      if (rest) this.push(rest);
      callback();
    }
  });
}

async function openPadronText(path: string): Promise<NodeJS.ReadableStream> {
  if (extname(path).toLowerCase() !== ".zip") return createReadStream(path);

  const directory = await unzipper.Open.file(path);
  const entry = directory.files.find((file) => /padron_reducido_ruc\.txt$/i.test(file.path))
    ?? directory.files.find((file) => /\.(txt|csv)$/i.test(file.path) && file.type !== "Directory");

  if (!entry) throw new Error("El ZIP de SUNAT no contiene padron_reducido_ruc.txt.");
  return entry.stream();
}

async function ingest(options: CliOptions) {
  await runMigrations();

  let sourcePath = options.file;
  let deleteWhenDone = false;
  let sha256: string | undefined;
  let sourceDate = options.sourceDate;
  let sourceLabel = options.file ? `file://${options.file}` : options.url;

  if (!sourcePath) {
    console.log(`Descargando Padrón Reducido RUC desde ${options.url}`);
    const downloaded = await downloadZip(options.url);
    sourcePath = downloaded.path;
    deleteWhenDone = true;
    sha256 = downloaded.sha256;
    sourceDate ??= downloaded.sourceDate;
  } else {
    sha256 = await sha256File(sourcePath);
  }

  if (!sourcePath) throw new Error("No se pudo resolver el archivo del padrón SUNAT.");

  const runId = await startSunatRucImport({ sourceUrl: sourceLabel, sourceUpdatedAt: sourceDate, sourceSha256: sha256 });
  let rowCount = 0;
  let batch: SunatRucImportRow[] = [];

  try {
    const rawStream = await openPadronText(sourcePath);
    const decoded = rawStream.pipe(latin1DecodeStream());
    const lines = readline.createInterface({ input: decoded, crlfDelay: Infinity });

    for await (const line of lines) {
      const row = parseSunatRucLine(line);
      if (!row) continue;
      batch.push(row);
      rowCount += 1;

      if (batch.length >= options.batchSize) {
        await upsertSunatRucRows({ runId, sourceUpdatedAt: sourceDate, rows: batch });
        batch = [];
        if (rowCount % 100_000 < options.batchSize) console.log(`Importados ${rowCount.toLocaleString("es-PE")} RUC...`);
      }
    }

    if (batch.length) await upsertSunatRucRows({ runId, sourceUpdatedAt: sourceDate, rows: batch });

    if (rowCount < options.minRows) {
      throw new Error(
        `La ingesta produjo ${rowCount.toLocaleString("es-PE")} filas; el mínimo de seguridad es ${options.minRows.toLocaleString("es-PE")}. No se depurará el padrón anterior.`
      );
    }

    await completeSunatRucImport({ runId, rowCount, pruneMissing: options.pruneMissing });
    console.log(`Padrón SUNAT actualizado: ${rowCount.toLocaleString("es-PE")} RUC. SHA-256 ${sha256 ?? "n/d"}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failSunatRucImport(runId, message, rowCount).catch(() => undefined);
    throw error;
  } finally {
    if (deleteWhenDone && sourcePath) await fs.unlink(sourcePath).catch(() => undefined);
  }
}

const options = parseArgs(process.argv.slice(2));
ingest(options)
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => closeDatabase());
