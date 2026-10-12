import { closeDatabase } from "./client.js";
import { runMigrations } from "./migrations.js";

try {
  await runMigrations();
  console.log("Migraciones aplicadas correctamente.");
} finally {
  await closeDatabase();
}
