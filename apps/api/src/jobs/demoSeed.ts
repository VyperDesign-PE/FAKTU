/**
 * Carga un negocio de demostración con ventas de los últimos 7 días, stock bajo
 * y fiados, para que el dashboard se vea "vivo" en una presentación.
 *
 *   npm run demo:seed                      (API en http://localhost:4000)
 *   DEMO_API_URL=http://localhost:4300 npm run demo:seed
 *
 * Usa la API pública y, solo para mover fechas hacia atrás, la misma base de
 * datos (DATABASE_URL). Es idempotente: si el usuario demo ya existe, no repite.
 * Todo queda en modo práctica (simulador): sin validez ante SUNAT.
 */
import { closeDatabase } from "../db/client.js";
import { DEMO_EMAIL, DEMO_PASSWORD, seedDemo } from "../modules/demo/demoData.js";

const API = (process.env.DEMO_API_URL ?? "http://localhost:4000").replace(/\/$/, "");

seedDemo(API)
  .then((created) => {
    if (!created) return console.log(`El usuario ${DEMO_EMAIL} ya existe: la demo ya estaba cargada. Para reiniciarla usa una base nueva.`);
    console.log(`\nDemo lista en ${API}\n  Usuario:    ${DEMO_EMAIL}\n  Contraseña: ${DEMO_PASSWORD}\n  Negocio:    Bodega Don Pepe (modo práctica, sin validez SUNAT)\n`);
  })
  .catch((error) => { console.error("demo:seed falló:", error instanceof Error ? error.message : error); process.exitCode = 1; })
  .finally(() => closeDatabase().catch(() => undefined));
