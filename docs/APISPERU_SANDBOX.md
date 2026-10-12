# APIsPERU Sandbox - MVP 0.12.0

## Objetivo

Conectar el contrato interno `BillingProvider` con la API real de Facturacion Electronica de APIsPERU sin acoplar el POS al proveedor.

La documentacion publica de APIsPERU indica:

- API REST base: `https://facturacion.apisperu.com/api/v1/`
- Emision de factura/boleta: `POST /invoice/send`
- Consulta posterior de CDR: `GET /invoice/status`
- El ambiente de empresa puede configurarse como `beta` para usar el ambiente de pruebas de SUNAT.
- Cada empresa configurada genera su propio token de uso para emision.

## Seguridad

El token de empresa NO se almacena en el movil y NO debe guardarse en texto plano en PostgreSQL.

Desde 0.13.0 el negocio **no** elige el secreto. Cada negocio usa su propia variable, que solo operaciones puede definir en el backend:

```env
# BILLING_TOKEN_ + tenantId sin guiones, en mayúsculas
BILLING_TOKEN_3F2B8C1A00004000800000000000001=...
```

Opcionalmente operaciones puede fijar en la base una referencia distinta, que siempre debe empezar por `BILLING_TOKEN_`:

```sql
update tenant_billing_settings
set credential_secret_ref = 'env:BILLING_TOKEN_EMPRESA_CENCA'
where tenant_id = '...';
```

Referencias a otras variables (`env:JWT_SECRET`, `env:DATABASE_URL`...) se rechazan. El token compartido `APISPERU_API_TOKEN` solo se usa en `sandbox` y únicamente con `BILLING_ALLOW_SHARED_SANDBOX_TOKEN=true` (útil para una empresa demo de pruebas); en producción nunca.

Para produccion, `secretResolver.ts` debe reemplazarse por un Secret Manager administrado.

## Flujo

```text
POS
  -> POST /v1/receipts
  -> PostgreSQL reserva serie/correlativo
  -> BillingService
  -> ApiPeruBillingProvider
  -> POST APIsPERU /invoice/send
  -> SUNAT beta
  -> CDR
  -> PostgreSQL
  -> PDF/enlace/entrega
```

## Proteccion ante duplicados

Si el POST al proveedor pudo llegar pero se pierde la respuesta, el adaptador devuelve `PENDING`. El backend NO reemite a ciegas. Primero consulta:

```text
GET /invoice/status?tipo=03&serie=B001&numero=1&ruc=...
```

Tambien existe:

```text
POST /v1/receipts/:id/reconcile
```

Esto complementa la idempotencia interna `tenant_id + client_transaction_id`.

## Artefactos

En sandbox se preservan:

- hash del XML,
- XML retornado por el proveedor,
- CDR ZIP,
- respuesta JSON del proveedor.

Se guardan en `receipt_provider_artifacts` para facilitar diagnostico del piloto. Para produccion se recomienda mover XML/CDR/PDF a object storage cifrado y conservar en PostgreSQL solo metadatos y claves de almacenamiento.

## Preparar una empresa beta

1. Crear/usar una cuenta en APIsPERU.
2. Configurar una empresa con `environment = beta` segun el procedimiento del proveedor.
3. Obtener el token propio de esa empresa.
4. Configurar variables del backend basadas en `.env.example`.
5. Ejecutar primero solo la prueba no destructiva:

```bash
npm run test:apisperu-sandbox
```

6. Solo cuando se confirme que la empresa esta en beta y se desea emitir una boleta de prueba por S/ 1.18:

```env
APISPERU_SANDBOX_CONFIRM=YES
```

Y volver a ejecutar el comando.

## Prueba local del adaptador sin credenciales

```bash
npm run test:apisperu-adapter
```

Esta prueba no accede a Internet ni SUNAT. Valida el mapeo de boleta, IGV, leyenda, parsing de respuesta y conciliacion con respuestas simuladas fieles al contrato documentado.

## Criterio para pasar a produccion

No cambiar a `production` hasta completar:

- boleta beta aceptada,
- factura beta aceptada,
- rechazo controlado,
- timeout despues de POST + conciliacion sin duplicar,
- XML y CDR preservados,
- PDF compartible,
- prueba multi-tenant,
- custodia de secretos en Secret Manager,
- revision contractual/comercial del proveedor.
