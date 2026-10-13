/**
 * Arranque concurrente: varios procesos migran la misma base vacía a la vez (como API + worker
 * con DB_AUTO_MIGRATE=true). Con el candado deben terminar todos bien y aplicar cada migración una vez.
 *
 * Requiere DATABASE_URL a una base LOCAL de pruebas y ALLOW_DB_TESTS=true. Crea y borra su propia base.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import postgres from "postgres";

if (process.env.ALLOW_DB_TESTS !== "true") throw new Error("ALLOW_DB_TESTS=true es obligatorio.");
const admin = new URL(process.env.DATABASE_URL ?? "");
if (!["localhost", "127.0.0.1"].includes(admin.hostname)) throw new Error(`Solo se permite una base local (host actual: ${admin.hostname}).`);

const name = `faktu_mig_${randomBytes(4).toString("hex")}`;
const adminSql = postgres(admin.toString(), { max: 1 });
const target = new URL(admin.toString());
target.pathname = `/${name}`;

function migrate(): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--import", "tsx", "src/db/migrate.ts"], { env: { ...process.env, DATABASE_URL: target.toString() }, shell: false });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", (code) => resolve({ code, output }));
  });
}

try {
  await adminSql.unsafe(`create database ${name}`);
  const runs = await Promise.all([migrate(), migrate(), migrate()]);
  for (const run of runs) assert.equal(run.code, 0, `una migración concurrente falló:\n${run.output}`);

  const check = postgres(target.toString(), { max: 1 });
  const rows = await check`select id from schema_migrations order by id`;
  const ids = rows.map((row) => row.id as string);
  assert.equal(new Set(ids).size, ids.length, "migraciones duplicadas");
  assert.ok(ids.length >= 11, `se esperaban al menos 11 migraciones, hay ${ids.length}`);
  await check.end();
  console.log(`MIGRATIONS LOCK: PASS (3 procesos concurrentes, ${ids.length} migraciones, sin errores)`);
} finally {
  await adminSql.unsafe(`drop database if exists ${name} with (force)`);
  await adminSql.end();
}
