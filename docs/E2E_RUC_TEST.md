# Prueba integral RUC + PostgreSQL — MVP 0.10.0

Esta prueba se ejecuta en una máquina con Docker, acceso a Internet y Node.js.

## 1. Levantar PostgreSQL

```bash
docker compose -f infra/docker-compose.yml up -d
npm install
npm run migrate
```

## 2. Prueba rápida del importador con fixture

```bash
npm --workspace @app/api run sync:sunat-ruc -- \
  --file src/fixtures/sunat_padron_sample.txt \
  --source-date 2026-08-28 \
  --min-rows 2 \
  --no-prune
```

Esto valida parser, migración, upsert por lotes y auditoría sin descargar cientos de MB.

## 3. Sincronización oficial SUNAT

```bash
npm run sync:sunat-ruc
```

No interrumpir la primera ingesta. El job muestra progreso por consola y registra el resultado en `sunat_ruc_import_runs`.

## 4. Levantar API

```bash
npm run dev:api
```

## 5. Registrar/login

Crear una cuenta desde la app o usar `POST /v1/auth/register` y conservar el JWT.

## 6. Verificar estado del padrón

```http
GET /v1/system/ruc-registry/status
Authorization: Bearer <JWT>
```

Debe devolver `ready: true` y una fecha `sourceUpdatedAt`.

## 7. Consultar RUC desde onboarding

```http
GET /v1/taxpayers/20142485878
Authorization: Bearer <JWT>
```

Con un padrón que contenga ese RUC, la respuesta debe indicar:

```json
{
  "ruc": "20142485878",
  "businessName": "INSTITUTO DE DESARROLLO URBANO CENCA",
  "source": "SUNAT_RUC_PADRON"
}
```

No se debe consumir `DOCUMENT_LOOKUP_API_TOKEN` para este caso.

## 8. Consultar el mismo RUC como cliente del POS

```http
POST /v1/customers/lookup
Authorization: Bearer <JWT>
Content-Type: application/json

{
  "tipoDoc": "RUC",
  "numero": "20142485878"
}
```

Verificar:

1. respuesta `source = SUNAT_RUC_PADRON`;
2. cliente persistido con el `tenant_id` de la sesión;
3. `external_lookup = false`;
4. `estimated_cost = 0`;
5. otro tenant no obtiene la ficha de cliente privada del primero, aunque ambos puedan consultar el mismo dato público del padrón SUNAT.

## 9. Verificar fallback

Con un RUC que no esté en el padrón cargado:

- si existe proveedor externo configurado, se usa como respaldo;
- si no existe, el POS muestra ingreso manual y la venta no queda bloqueada.

## 10. Criterio de aprobación

El bloque RUC queda aprobado cuando onboarding y POS recuperan razón social/estado/dirección desde el padrón oficial, el cliente queda persistido por tenant y el contador de costo externo permanece en S/ 0 para consultas resueltas por `SUNAT_RUC_PADRON`.
