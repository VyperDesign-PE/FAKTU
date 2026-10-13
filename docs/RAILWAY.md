# FAKTU en Railway

Railway corre la misma imagen Docker de FAKTU (`infra/Dockerfile`) y una base PostgreSQL administrada. El archivo `railway.toml` ya define la construcción, el health check (`/health/ready`) y el reinicio automático.

## Costos (confírmalos en https://railway.com/pricing)

| Etapa | Plan | Costo |
|---|---|---|
| Demo y pruebas | Trial: crédito único de US$ 5 | US$ 0 (dura unas semanas con app + base) |
| Clientes reales | Hobby: US$ 5/mes con US$ 5 de consumo incluidos | ≈ US$ 5–10/mes (app + PostgreSQL) |
| Crecimiento | Pro: US$ 20/mes + consumo, réplicas, más recursos | según uso |

El plan Free (US$ 1/mes de crédito) no alcanza para tener la app y la base encendidas todo el mes.

## Paso a paso (≈ 10 minutos)

1. Entra a https://railway.com con tu cuenta de GitHub.
2. **New Project → Deploy from GitHub repo** → `VyperDesign-PE/FAKTU`. En *Settings → Source* elige la rama `faktu-0.13-estabilizacion` (o `main` cuando se fusione). Railway detecta `railway.toml` y construye con el Dockerfile.
3. En el mismo proyecto: **New → Database → PostgreSQL**.
4. En el servicio FAKTU → **Variables**, agrega:

   | Variable | Valor |
   |---|---|
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (referencia a la base del paso 3) |
   | `NODE_ENV` | `production` |
   | `DB_AUTO_MIGRATE` | `true` |
   | `JWT_SECRET` | resultado de `openssl rand -hex 32` |
   | `SECRETS_MASTER_KEY` | otro `openssl rand -hex 32` (guárdalo también fuera de Railway) |
   | `PUBLIC_RECEIPT_LINK_SECRET` | otro `openssl rand -hex 32` |
   | `BILLING_PROVIDER` | `mock` (demo) |
   | `DELIVERY_PROVIDER` | `mock` |
   | `DEMO_AUTOSEED` / `DEMO_PUBLIC_LOGIN` | `true` para la demo; `false` con clientes reales |
   | `ALERT_WEBHOOK_URL` | opcional: webhook de Slack/Discord |

   Sin acceso a una terminal, genera los secretos en https://www.random.org/strings (64 caracteres hexadecimales) o pídeme que te explique otra forma.
5. **Settings → Networking → Generate Domain**: obtienes `https://faktu-production.up.railway.app`. Con dominio propio: *Custom Domain* (`app.tudominio.pe`) y un registro CNAME en Cloudflare.
6. Espera a que el despliegue quede **Active** (los Logs muestran `demo cargada` si activaste la demo) y abre el enlace.

## Al pasar a clientes reales
- Cambia a **Hobby** antes de que se acabe el crédito de prueba (si se agota, los servicios se detienen).
- `DEMO_AUTOSEED=false`, `DEMO_PUBLIC_LOGIN=false` y, si la demo ya cargó, usa una base nueva para producción.
- **Worker aparte** (opcional, recomendado con más negocios): duplica el servicio (*New → GitHub repo*, mismo repo), en *Settings → Deploy → Custom Start Command* pon `../../node_modules/.bin/tsx src/worker.ts`, copia las variables y en el servicio web pon `RECEIPT_WORKER_ENABLED=false`.
- **Respaldos**: activa los backups de la base en Railway (planes de pago) y además una copia semanal fuera (`pg_dump` con la URL pública de la base).
- Facturación real: tokens por negocio en la bóveda (`npm run ops:secret`, desde *railway run* o una terminal con `DATABASE_URL`), siguiendo `docs/PILOTO.md`.
