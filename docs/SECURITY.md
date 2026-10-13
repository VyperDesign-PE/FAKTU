# FAKTU — Arquitectura y seguridad

## Arquitectura objetivo (y cómo se corre)

```
Cloudflare (WAF, DDoS, CDN, TLS)
   └─ Caddy (HTTPS)  ──►  faktu  (API + web PWA, monolito modular)
                           worker (reintentos y conciliación con SUNAT/proveedor)
                           PostgreSQL (datos, bóveda cifrada, bitácora, archivo XML/CDR)
```

- **Monolito modular**: ventas, comprobantes, stock, fiados, reportes, seguridad y adaptadores de proveedor en un solo código base. Menos piezas que fallen.
- **Dos procesos, una imagen**: `faktu` atiende web y API; `worker` hace reintentos con el proveedor/SUNAT. Un candado de PostgreSQL (`pg_try_advisory_xact_lock`) impide que dos procesos trabajen a la vez. El estado de cada comprobante vive en la base: un reinicio no pierde nada.
- **Cómo correrlo**
  - Demo local: `npm run demo:up` + `npm run demo:seed` (la API incluye el worker).
  - Producción en VPS: `docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod up -d --build` (servicios `postgres`, `faktu`, `worker`, `caddy`). Ver `docs/DEPLOY.md`.
  - Desarrollo: `npm run dev:api` (con worker integrado) o `RECEIPT_WORKER_ENABLED=false npm run dev:api` y `npm run worker` en otra terminal.

## Qué está implementado

| Control | Detalle |
|---|---|
| Aislamiento por negocio | `tenantId` siempre sale del token de sesión, nunca del cliente. Prueba E2E: otro negocio recibe 404 al pedir/modificar recibos, productos, stock, fiados y archivos. |
| Sesiones | Token de acceso de 15 min con id de sesión (cerrar sesión lo invalida al instante) y token de renovación rotativo de 30 días guardado solo como hash. Reusar un token ya rotado revoca todo ese dispositivo. "Cerrar sesión en todos los dispositivos" en la app. |
| Verificación en dos pasos (TOTP) | Opcional por usuario (Más → Seguridad). Compatible con Google Authenticator, Authy y 1Password. La contraseña sola ya no abre sesión; el token intermedio dura 5 min y no sirve como sesión. 8 códigos de recuperación de un solo uso. |
| Bóveda de credenciales | Tokens/URL de proveedor cifrados con AES-256-GCM (`SECRETS_MASTER_KEY`), atados al negocio: un valor copiado a otro negocio no descifra. Se cargan por `npm run ops:secret` (entrada estándar, sin historial de terminal). |
| Bitácora de auditoría | Tabla de solo agregado (un trigger impide UPDATE/DELETE) con ventas, anulaciones, notas, bajas, guías, cobros, ajustes de stock, cambios de configuración, ingresos y 2FA. El dueño la ve en la app. |
| Archivo XML/CDR | El worker descarga y guarda en la base los XML y CDR cuando el proveedor solo entrega un enlace (conservación por 5 años). Descarga: `GET /v1/receipts/:id/files/{xml\|cdr}`. |
| Cabeceras y CORS | `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, CSP `frame-ancestors`, HSTS en producción. CORS cerrado en producción salvo `CORS_ORIGINS`. |
| Monitoreo | `/health/ready` (base de datos y documentos atascados) para el balanceador o un monitor externo; alertas a Slack/Discord (`ALERT_WEBHOOK_URL`) si hay documentos sin respuesta por más de 30 min o si falla el worker. |
| Demo pública | La cuenta demo no puede activar 2FA ni cerrar sesiones de otros visitantes. |
| Límite de intentos | Login, 2FA, búsquedas y enlaces públicos tienen rate limit. |
| Sin Clave SOL | Nunca se pide ni se guarda la Clave SOL principal del negocio. |
| Idempotencia y estados finales | Un comprobante nunca se emite dos veces ni un estado final retrocede (probado). |

## Qué falta (en orden recomendado)

1. **Row Level Security en PostgreSQL** como segunda barrera del aislamiento. Requiere envolver todas las consultas en una transacción que fije `app.tenant_id` y usar un rol sin privilegios de dueño; es un cambio transversal que conviene hacer con calma y con la prueba de aislamiento actual como red de seguridad.
2. **Gestor de claves externo** (AWS KMS / GCP KMS) en lugar de `SECRETS_MASTER_KEY` en un archivo: se cambia solo `masterKey()` en `modules/security/vault.ts`.
3. **Respaldos con recuperación a un punto en el tiempo** (PITR) y copia fuera del servidor: hoy hay `pg_dump` diario (`scripts/backup-db.sh`).
4. **Almacenamiento de objetos (S3/R2)** para XML/CDR/PDF cuando el volumen crezca; hoy se guardan en PostgreSQL.
5. **Roles de cajero** (permisos por usuario dentro del negocio).
6. **Rastreo de errores** (Sentry u otro) además de las alertas por webhook.
7. **Ley 29733** (datos personales): política de privacidad, consentimiento y registro del banco de datos ante la autoridad.
