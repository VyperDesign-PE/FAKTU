# API MVP 0.12.0

Base URL local: `http://localhost:4000`

Todas las rutas `/v1/*` protegidas reciben JWT. El backend obtiene `tenantId` desde el token y no confía en un `tenantId` enviado por el cliente.

## Autenticación

### POST `/v1/auth/register`
Crea usuario, tenant inicial, membresía OWNER, suscripción trial y configuración de proveedor mock.

### POST `/v1/auth/login`
Devuelve sesión JWT con `tenantId`.

### GET `/v1/auth/me`
Devuelve usuario y tenant activo.

### POST `/v1/auth/otp/request`
Solicita OTP para celular.

### POST `/v1/auth/otp/verify`
Verifica OTP.

## Negocio

### GET `/v1/business`
Devuelve los datos persistidos del tenant autenticado.

### PATCH `/v1/business`
Actualiza RUC, razón social, nombre comercial, dirección, ubigeo, departamento, provincia, distrito, teléfono, correo, estado tributario y `onboardingComplete`.

## SaaS

### GET `/v1/subscription`
Devuelve plan, estado y fechas del tenant autenticado.

## Estado

### GET `/v1/system-status`
Consulta estado del proveedor configurado para el tenant y devuelve un mensaje simplificado para la UI.

## Clientes

### POST `/v1/customers/lookup`
Búsqueda optimizada por tipo de documento.

**DNI:** cliente del tenant -> API DNI solo si es nuevo -> persistencia para futuras visitas.

**RUC:** Padrón Reducido oficial de SUNAT indexado en PostgreSQL -> cliente del tenant -> proveedor externo opcional de respaldo. La consulta al padrón local tiene costo API S/ 0.

Todo resultado nuevo se guarda en `customers` y el consumo/origen se registra en `document_lookup_usage`.

Body:

```json
{ "tipoDoc": "DNI", "numero": "44556677" }
```

Respuesta posible desde cache:

```json
{
  "tipoDoc": "DNI",
  "numero": "44556677",
  "nombreCompleto": "JUAN CARLOS PEREZ GARCIA",
  "source": "CACHE_SERVER",
  "originalSource": "API_DNI",
  "customerId": "..."
}
```

### GET `/v1/customers?q=...&limit=50`
Busca clientes del tenant por nombre o documento.

### GET `/v1/customers/:id`
Detalle de cliente, siempre filtrado por tenant.

### POST `/v1/customers`
Crea o actualiza un cliente ingresado manualmente.

### GET `/v1/customer-lookups/summary`
Resumen mensual de consultas totales, externas, cache hits y costo estimado.

## Productos

### GET `/v1/products`
Lista catálogo persistido del negocio.

### PUT `/v1/products/:clientProductId`
Upsert idempotente de producto. `clientProductId` permite sincronización offline sin duplicar productos.

## Comprobantes

### POST `/v1/receipts`

Flujo:

1. valida payload;
2. verifica idempotencia `tenantId + clientTransactionId`;
3. persiste cliente manual si corresponde;
4. reserva correlativo atómicamente;
5. persiste cabecera e items;
6. llama a `BillingProvider`;
7. actualiza estado y URLs del proveedor.

Estados API normalizados:

- `ACCEPTED`
- `PENDING`
- `REJECTED`
- `ERROR`

Estados persistidos:

- `PENDIENTE`
- `ENVIANDO`
- `ACEPTADO`
- `OBSERVADO`
- `RECHAZADO`
- `ERROR`

### GET `/v1/receipts?limit=100`
Historial persistido del tenant.

### GET `/v1/receipts/:id`
Detalle con líneas del comprobante.

### GET `/v1/receipts/by-transaction/:clientTransactionId`
Recupera un comprobante usando la clave idempotente del celular.

### POST `/v1/receipts/:id/reconcile`
Consulta el estado del comprobante en el proveedor sin volver a emitirlo. En APIsPERU usa `GET /invoice/status`. Se utiliza especialmente cuando el POST de emisión pudo llegar al proveedor pero la respuesta se perdió por timeout/corte de red.

## RUC propio

### GET `/v1/taxpayers/:ruc`
Consulta inicial del RUC del negocio. Primero usa `sunat_ruc_registry`, sincronizado desde el Padrón Reducido oficial de SUNAT. Si el RUC no aparece, puede usar el proveedor externo configurado como respaldo.

La respuesta puede incluir `source: SUNAT_RUC_PADRON` y `sourceUpdatedAt`.

### GET `/v1/system/ruc-registry/status`
Devuelve si existe un padrón válido cargado, su fecha de fuente, cantidad de registros de la última importación completa y estado de la última sincronización.

## Autorización de proveedor

### POST `/v1/pse/authorization-session`
Punto de entrada para iniciar el flujo de autorización del proveedor/PSE. Continúa en MOCK hasta elegir integración real.

## Proveedores externos

La configuración se resuelve desde `tenant_billing_settings`. El proveedor por defecto se controla con `BILLING_PROVIDER`.

Ver `docs/BILLING_PROVIDER_ARCHITECTURE.md` y `docs/PERSISTENCE_MVP.md`.

## Configuracion de facturacion - 0.7.0

### GET `/v1/billing/providers`
Lista los proveedores candidatos disponibles para configuracion del tenant. No devuelve secretos.

### GET `/v1/billing/settings`
Devuelve proveedor, ambiente, referencia de cuenta, estado de conexion y si existe una credencial segura configurada.

### PATCH `/v1/billing/settings`
Actualiza proveedor/ambiente por tenant. Solo el titular (`OWNER`/`ADMIN`) puede usarlo. El móvil nunca envía el token ni elige qué secreto se usa: desde 0.13.0 el campo `credentialSecretRef` se rechaza (400) y tampoco se devuelve en `GET`.

`environment: "production"` responde 409 mientras la plataforma no defina `BILLING_PRODUCTION_ENABLED=true`.

Ejemplo:

```json
{
  "providerCode": "apisperu",
  "environment": "sandbox",
  "providerAccountRef": "empresa-beta-001"
}
```

La credencial de cada negocio la asigna operaciones en el backend (ver `docs/APISPERU_SANDBOX.md`).

### POST `/v1/billing/test-connection`
Prueba la configuracion del proveedor y persiste `connection_status`, `last_tested_at` y `last_error`.

APIsPERU dispone de adaptador nativo en 0.12.0. Usa `POST /invoice/send` para emisión y `GET /invoice/status` para conciliación. Los demás proveedores nombrados continúan con probe seguro hasta implementar sus adaptadores específicos.

En sandbox, hash/XML/CDR y respuesta del proveedor se preservan en `receipt_provider_artifacts` para diagnóstico. Antes de producción deben migrarse a almacenamiento de objetos cifrado.


## Compartir comprobantes - 0.8.0

### `POST /v1/receipts/by-transaction/:clientTransactionId/share`

Autenticado. Genera un paquete de entrega solo si el comprobante pertenece al tenant del JWT y está aceptado.

Respuesta:

```json
{
  "documentType": "BOLETA",
  "documentNumber": "B001-00000001",
  "total": 18.50,
  "viewUrl": "https://comprobantes.example/r?t=...",
  "pdfUrl": "https://comprobantes.example/r/pdf?t=...",
  "whatsappText": "Mi Bodega te envía tu boleta...",
  "emailSubject": "BOLETA B001-00000001 - Mi Bodega",
  "emailBody": "...",
  "expiresAt": "2026-09-27T...Z"
}
```

### `POST /v1/receipts/:id/share`

Equivalente usando el UUID interno del comprobante.

### `GET /r?t=<token>`

Público mediante token firmado y expirable. Renderiza una vista web amigable para el cliente. No requiere JWT.

### `GET /r/pdf?t=<token>`

Público mediante token firmado `PDF`. Genera una representación PDF del comprobante.

Los tokens públicos no contienen datos personales ni credenciales de facturación.


## Cola de entrega - 0.9.0

### POST `/v1/receipts/by-transaction/:clientTransactionId/deliveries`
Programa una entrega por `WHATSAPP`, `EMAIL` o `SMS`. Si el comprobante aún no está aceptado queda en `WAITING_RECEIPT`.

### GET `/v1/deliveries?limit=100`
Lista entregas del tenant.

### POST `/v1/deliveries/process-pending`
Procesa pendientes en desarrollo. En producción debe ejecutarlo un worker interno.

> `DELIVERY_PROVIDER=disabled` es seguro por defecto: no marca mensajes como enviados si no existe un adaptador real.
