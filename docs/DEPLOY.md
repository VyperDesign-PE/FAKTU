# FAKTU — Despliegue barato y estable (VPS)

Para el piloto, la opción con mejor relación precio/estabilidad es **un VPS pequeño con Docker**: siempre encendido (los reintentos con SUNAT corren en segundo plano), PostgreSQL incluido y HTTPS automático.

## Costo mensual aproximado

| Opción | Costo | Comentario |
|---|---|---|
| **Hetzner CX22** (2 vCPU, 4 GB) | ~€4–5 | La mejor relación calidad/precio. Recomendada. |
| DigitalOcean / Vultr (1 GB) | ~US$ 6 | Más conocido en Latinoamérica; mismo procedimiento. |
| Oracle Cloud "Always Free" (ARM) | US$ 0 | Gratis, pero conseguir capacidad es difícil y la cuenta puede suspenderse. Solo para pruebas. |
| Render de pago (web + base) | ~US$ 13 | Sin mantenimiento, pero el doble de caro. |
| Dominio `.pe` | ~US$ 30–40/año | Opcional; un `.com` sale ~US$ 10/año. |
| Cloudflare (DNS, CDN, certificado) | US$ 0 | Plan gratuito. |

Total típico: **≈ US$ 5/mes + dominio**. Alcanza para decenas de negocios.

## Pasos (≈ 1 hora)

1. **Crea el servidor**: Ubuntu 24.04, 2 vCPU / 2–4 GB. Agrega tu llave SSH.
2. **Dominio**: en Cloudflare crea un registro `A` (`app` → IP del servidor). Déjalo en "solo DNS" (nube gris) la primera vez, para que Caddy obtenga el certificado.
3. **Instala Docker** en el servidor:
   ```bash
   curl -fsSL https://get.docker.com | sh
   ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw --force enable
   ```
4. **Clona y configura**:
   ```bash
   git clone -b main https://github.com/VyperDesign-PE/FAKTU /opt/faktu && cd /opt/faktu
   cp infra/.env.prod.example infra/.env.prod
   nano infra/.env.prod     # DOMAIN y los 4 secretos (openssl rand -hex 32)
   # IMPORTANTE: guarda SECRETS_MASTER_KEY también fuera del servidor (gestor de contraseñas).
   ```
5. **Levanta**:
   ```bash
   docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod up -d --build
   docker compose -f infra/docker-compose.prod.yml logs -f faktu   # Ctrl+C para salir
   ```
   Abre `https://app.tudominio.pe`. Para una demo pública, pon `DEMO_AUTOSEED=true` antes y vuelve a levantar.
6. **Copias de seguridad** (obligatorio): `crontab -e` y agrega
   `0 3 * * * /opt/faktu/scripts/backup-db.sh >> /var/log/faktu-backup.log 2>&1`.
   Descarga una copia a tu PC de vez en cuando (`scp`) o activa los backups del proveedor (~20 % extra).
7. **Actualizar** a una nueva versión:
   ```bash
   cd /opt/faktu && git pull && docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod up -d --build
   ```
   Las migraciones corren solas al iniciar.
8. **Facturación real**: carga el token de cada negocio en la bóveda cifrada, sin dejar rastro en el historial:
   ```bash
   echo -n "TOKEN_DEL_NEGOCIO" | docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod exec -T faktu npm --workspace @app/api run ops:secret -- correo@negocio.pe token
   ```
   (Nubefact además necesita `url`.) Luego activa el proveedor del negocio como indica `docs/PILOTO.md`. Nunca pongas tokens en Git.
9. **Servicios**: `faktu` (web + API), `worker` (reintentos con SUNAT), `postgres` y `caddy`. Si un comprobante queda pendiente, el `worker` lo reintenta aunque nadie abra la app: `docker compose ... logs -f worker`.

## Monitoreo
- `https://tu-dominio/health/ready` responde 200 si la base está arriba y muestra documentos atascados; úsalo en UptimeRobot o Better Stack (gratis) para que te avise si cae.
- Pon un webhook de Slack o Discord en `ALERT_WEBHOOK_URL` y el worker avisará si hay documentos sin respuesta por más de 30 minutos.

## Si algo falla
- `docker compose ... ps` muestra el estado; `logs faktu` el detalle.
- Certificado no emitido: confirma que el DNS apunta al servidor y que los puertos 80/443 están abiertos.
- Sin espacio: `docker system prune -f` y revisa `/var/backups/faktu`.

## Más adelante
Con más de ~30 negocios conviene separar la base de datos (Neon, Supabase o la administrada del proveedor) y tener un segundo servidor de respaldo.
