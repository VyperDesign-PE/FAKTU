# Persistencia real del MVP 1.0

## Objetivo

La versión 0.5.0 reemplaza la persistencia temporal de comprobantes en memoria por PostgreSQL y mantiene la app móvil en modo offline-first.

El aislamiento multi-tenant se aplica usando siempre `tenant_id` obtenido del JWT autenticado. El cliente móvil nunca decide qué tenant leer o modificar.

## Modelo relacional

```text
app_users
   │
   └── tenant_memberships ── tenants
                               │
                               ├── subscriptions
                               ├── tenant_billing_settings
                               ├── customers
                               ├── products
                               ├── document_series
                               ├── receipts ── receipt_items
                               └── document_lookup_usage
```

### `tenants` = Negocios

Guarda RUC, razón social, nombre comercial, dirección, datos de contacto, estado tributario y estado de onboarding.

La credencial de facturación NO se almacena en texto plano en `tenants`. `tenant_billing_settings.credential_secret_ref` contiene únicamente una referencia a un secreto administrado. En producción debe resolverse desde un Secret Manager.

Índices relevantes:

- RUC único cuando no es nulo.
- PK UUID.

### `customers` = Clientes

Campos principales:

- `tenant_id`
- `document_type` (`DNI`/`RUC`)
- `document_number`
- `full_name`
- `address`
- `phone`
- `email`
- `data_source`
- `verified_at`

Restricción central:

```text
UNIQUE (tenant_id, document_type, document_number)
```

Esto permite que dos negocios tengan al mismo cliente sin mezclar sus datos.

Búsqueda rápida:

```text
INDEX (tenant_id, document_type, document_number)
```

### Cache de clientes en tres niveles

```text
DNI/RUC
  │
  ├─ 1. AsyncStorage del dispositivo
  │      └─ si existe: respuesta inmediata, incluso offline
  │
  ├─ 2. PostgreSQL / customers del tenant
  │      └─ si existe: no consume API externa
  │
  └─ 3. Proveedor externo
         └─ guardar en customers para futuras ventas
```

La tabla `document_lookup_usage` registra si la consulta fue cache o externa y el costo estimado. Esto permite medir el consumo real por plan SaaS.

### `products`

Catálogo persistido por tenant.

Se conserva `client_product_id` para poder crear productos offline en el celular y sincronizarlos después sin generar duplicados.

Restricción:

```text
UNIQUE (tenant_id, client_product_id)
```

### `document_series`

Controla correlativos por tenant, tipo de comprobante y serie.

```text
UNIQUE (tenant_id, document_type, series)
```

El siguiente correlativo se reserva mediante un `UPDATE ... RETURNING` dentro de una transacción PostgreSQL. No se usa `MAX(correlative)+1`, evitando colisiones entre dos cajas simultáneas.

Series iniciales del MVP:

- Boleta: `B001`
- Factura: `F001`

Son configurables mediante variables de entorno y posteriormente serán configurables por tenant.

### `receipts` = Comprobantes/Ventas

Persistencia de cabecera:

- tenant
- cliente
- `client_transaction_id`
- constancia temporal
- tipo de documento
- serie/correlativo
- número oficial
- fecha
- subtotal
- IGV
- total
- estado SUNAT/proveedor
- snapshot del cliente
- IDs/respuestas del proveedor
- referencias PDF/XML/CDR
- número de intentos

Idempotencia:

```text
UNIQUE (tenant_id, client_transaction_id)
```

Numeración:

```text
UNIQUE (tenant_id, document_type, series, correlative)
```

El snapshot de nombre/documento/dirección del cliente se guarda en el comprobante para que una futura edición de la ficha de cliente no altere el historial tributario.

### `receipt_items`

Guarda cada línea de venta con descripción, cantidad, unidad, precio, subtotal, IGV y total. Los datos son snapshots del momento de emisión.

### `document_lookup_usage`

Permite calcular por tenant:

- consultas totales;
- consultas externas;
- cache hits;
- costo estimado mensual;
- éxito/fallo del proveedor.

Endpoint de resumen:

```text
GET /v1/customer-lookups/summary
```

## Flujo de emisión persistente

```text
Celular crea clientTransactionId
        │
        ▼
POST /v1/receipts
        │
        ▼
¿Ya existe tenant + transactionId?
  │ sí                │ no
  ▼                   ▼
reusar registro   reservar correlativo
                      │
                      ▼
                 insertar receipt + items
                      │
                      ▼
                 llamar BillingProvider
                      │
          ┌───────────┼───────────┐
          ▼           ▼           ▼
       aceptado    pendiente     error
          │           │           │
          └───────────┴───────────┘
                      │
                      ▼
              actualizar PostgreSQL
```

Si la red se interrumpe, el mismo `clientTransactionId` puede reenviarse. El backend reutiliza el comprobante persistido y el adaptador externo recibe la misma clave de idempotencia.

## Endpoints persistentes

- `GET /v1/business`
- `PATCH /v1/business`
- `GET /v1/products`
- `PUT /v1/products/:clientProductId`
- `GET /v1/customers`
- `GET /v1/customers/:id`
- `POST /v1/customers`
- `POST /v1/customers/lookup`
- `GET /v1/customer-lookups/summary`
- `POST /v1/receipts`
- `GET /v1/receipts`
- `GET /v1/receipts/:id`
- `GET /v1/receipts/by-transaction/:clientTransactionId`

## Migraciones

En desarrollo:

```bash
npm run migrate
```

El servidor también puede aplicar migraciones al iniciar con:

```env
DB_AUTO_MIGRATE=true
```

En producción se recomienda:

1. `DB_AUTO_MIGRATE=false` en el proceso web.
2. Ejecutar `npm run migrate` como etapa controlada del despliegue.
3. Hacer backup antes de migraciones destructivas.

## Seguridad

- `tenantId` proviene del JWT, no del body.
- Clave SOL nunca se persiste.
- Token del proveedor no se expone al móvil.
- Credenciales de facturación deben vivir en un Secret Manager.
- URLs públicas permanentes de PDF/XML no son recomendables; la siguiente etapa generará enlaces firmados temporales desde almacenamiento privado.

## Índice oficial RUC — 0.10.0

La tabla `sunat_ruc_registry` es global porque representa un padrón público oficial y no datos privados de un tenant. No reemplaza `customers`: cuando un negocio consulta un RUC, los datos pertinentes se copian/actualizan en su propia cartera de clientes.

La separación es intencional:

```text
sunat_ruc_registry        customers
 dato público global  ->  relación comercial por tenant
```

La clave primaria `sunat_ruc_registry.ruc` permite lookup exacto inmediato. La actualización diaria se audita en `sunat_ruc_import_runs`; ver `SUNAT_RUC_REGISTRY.md`.
