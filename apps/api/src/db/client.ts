import postgres from "postgres";

const connectionString = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/facturacion";

export const sql = postgres(connectionString, {
  max: Number(process.env.DB_POOL_SIZE ?? 10),
  idle_timeout: 20,
  connect_timeout: 10,
  prepare: true
});

export async function closeDatabase() {
  await sql.end({ timeout: 5 });
}
