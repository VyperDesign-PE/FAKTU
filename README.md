# FAKTU

> **En línea:** Railway (`railway.toml`, ver [docs/RAILWAY.md](docs/RAILWAY.md)) o Render → New → Blueprint con este repositorio (usa `render.yaml`). Ver [docs/DEMO.md](docs/DEMO.md#c-en-línea-con-https-render-10-minutos-gratis).
>
> **Demo local:** `npm run demo:up` y `npm run demo:seed` — ver [docs/DEMO.md](docs/DEMO.md).

Facturación electrónica SaaS multiempresa para pequeños negocios del Perú: bodegas, librerías, restaurantes de menú y comercios similares. App web/móvil (React Native + Expo, PWA), API (Fastify + PostgreSQL) y facturación electrónica con APIsPERU o Nubefact mediante adaptadores desacoplados.

## Versión actual: 0.19.0 — lista para el piloto

- **Proveedor:** APIsPERU para el piloto (sin pago inicial, S/ 25 por negocio). Nubefact (OSE/PSE) queda listo como alternativa para escalar.
- **Plataforma:** app web instalable (PWA), servida por la misma API. La app Android sale del mismo código cuando el piloto lo valide.
- **Documentos:** boletas, facturas, notas de crédito (anulación, devolución parcial, descuento, error de RUC), notas de débito, comunicaciones de baja y resúmenes de baja, y guías de remisión remitente y transportista.
- **Funciones:** venta con Yape, Plin, efectivo (con vuelto), tarjeta o transferencia; cierre de caja; registro de ventas para el contador; modo práctica aislado.
- **Operación del piloto:** ver **`docs/PILOTO.md`** (decisiones, activación de negocios, homologación, despliegue y riesgos).

Historial de cambios en `CHANGELOG.md`.

## Inicio rápido

```bash
npm ci                      # dependencias fijadas en package-lock.json
npm run typecheck           # API + app móvil
npm test                    # pruebas unitarias y de adaptadores Nubefact/APIsPERU (sin base de datos)
EXPO_PUBLIC_API_URL=http://localhost:4000 npm run dev:web   # app web en desarrollo (con npm run dev:api)
npm run build:web           # build de la PWA (apps/mobile/dist-web)

# Con PostgreSQL de PRUEBAS:
DATABASE_URL=postgres://postgres:postgres@localhost:5432/faktu_test ALLOW_DB_TESTS=true npm run test:integration
DATABASE_URL=postgres://postgres:postgres@localhost:5432/faktu_e2e scripts/run-e2e-local.sh   # E2E sin Docker
npm run e2e:up              # E2E con Docker
docker build -f infra/Dockerfile -t faktu .   # imagen de producción (API + web)
```

Todo esto corre automáticamente en GitHub Actions (`.github/workflows/ci.yml`) en cada push y pull request.

## Stack

- **Cliente:** React Native + Expo + TypeScript.
- **Navegación:** React Navigation Native Stack + shell responsivo propio.
- **Responsive:** desde 900 px muestra barra lateral; en móvil usa navegación inferior.
- **Estilos:** React Native `StyleSheet` con tokens en `theme.ts`.
- **Sesión móvil:** `expo-secure-store`.
- **Persistencia offline:** AsyncStorage aislado por `tenantId`.
- **Consulta DNI:** dispositivo -> clientes PostgreSQL -> proveedor externo solo si es nuevo.
- **Consulta RUC:** Padrón Reducido SUNAT indexado en PostgreSQL -> caché del tenant -> respaldo externo opcional.
- **Red:** NetInfo.
- **Backend:** Fastify + TypeScript + Zod + JWT.
- **Base de datos:** PostgreSQL.
- **Multi-tenancy:** tenants + memberships + suscripciones + configuración de proveedor.
- **Hash de contraseñas:** scrypt de Node.js.
- **Facturación externa:** contrato `BillingProvider` desacoplado; mock por defecto y adaptador nativo APIsPERU disponible para sandbox.


## Sandbox real de facturacion

El primer adaptador nativo implementado es **APIsPERU**. El backend traduce nuestro modelo canonico al contrato documentado `POST /invoice/send` y puede conciliar un resultado incierto con `GET /invoice/status`.

Prueba local sin credenciales:

```bash
npm run test:apisperu-adapter
```

Prueba contra sandbox real, una vez configurado el token de una empresa beta:

```bash
npm run test:apisperu-sandbox
```

La primera ejecucion solo valida conectividad. Para emitir una boleta beta controlada se requiere `APISPERU_SANDBOX_CONFIRM=YES`. Ver `docs/APISPERU_SANDBOX.md`.

## Persistencia del MVP

PostgreSQL ahora almacena:

- `tenants`: negocio, RUC, razón social y onboarding.
- `customers`: clientes separados por tenant.
- `products`: catálogo por tenant.
- `document_series`: series y correlativos atómicos.
- `receipts`: cabecera del comprobante, estado y respuesta del proveedor.
- `receipt_items`: detalle de cada venta.
- `document_lookup_usage`: consumo y costo estimado de consultas DNI/RUC.
- `sunat_ruc_registry`: índice global del Padrón Reducido RUC oficial.
- `sunat_ruc_import_runs`: auditoría y versión de cada sincronización SUNAT.
- `subscriptions` y `tenant_billing_settings`: SaaS y proveedor de facturación.

La clave de idempotencia persistente es:

```text
tenant_id + client_transaction_id
```

Esto evita duplicar comprobantes cuando una venta offline se reenvía varias veces.

## Clientes y ahorro de consultas DNI

Para **DNI**, la búsqueda usa tres niveles:

```text
1. Cache local del celular
2. Tabla customers del negocio
3. API DNI externa solo si el cliente es nuevo
```

Para **RUC**, usamos el Padrón Reducido oficial de SUNAT previamente sincronizado en PostgreSQL. La búsqueda por RUC no consume una API comercial por consulta. Si el RUC aún no aparece en el padrón cargado, puede usarse un proveedor externo opcional o ingreso manual.

El costo unitario estimado del DNI se configura en backend:

```env
DOCUMENT_LOOKUP_DNI_COST_PEN=0
```

Por ejemplo, si el contrato futuro fuese S/ 30 por 1,000 consultas, se configuraría `0.03`.

## Correlativos

No se utiliza `MAX(correlative) + 1`. PostgreSQL reserva el siguiente correlativo mediante una actualización atómica de `document_series` dentro de una transacción.

Series iniciales:

- Boleta: `B001`
- Factura: `F001`

## Multi-tenancy y seguridad

El `tenantId` viaja en el JWT y el servidor lo obtiene exclusivamente de la sesión autenticada. El backend no confía en un `tenantId` enviado por el móvil.

La Clave SOL **nunca se persiste**.

Las credenciales de Nubefact/PSE/API tampoco deben almacenarse como texto plano en `tenants`; `tenant_billing_settings.credential_secret_ref` está preparado para apuntar a un Secret Manager.

## Configuración

```bash
cp apps/api/.env.example apps/api/.env
cp apps/mobile/.env.example apps/mobile/.env
```

En producción cambia obligatoriamente `JWT_SECRET` y usa un almacén seguro de secretos.

## PostgreSQL y Redis

```bash
docker compose -f infra/docker-compose.yml up -d
```

## Instalar dependencias

```bash
npm install
```

## Ejecutar migraciones

```bash
npm run migrate
```

En desarrollo también puede usarse:

```env
DB_AUTO_MIGRATE=true
```

En producción se recomienda ejecutar la migración como paso separado del deploy y usar `DB_AUTO_MIGRATE=false` en el proceso web.

## Ejecutar la API

```bash
npm run dev:api
```

## Ejecutar la app

```bash
npm run dev:mobile
```

## Importante

FAKTU **todavía no emite comprobantes legales reales ante SUNAT**. El proveedor por defecto es `mock` (en producción solo se bloquea si defines `ALLOW_MOCK_BILLING=false`; el valor por defecto es `true` para poder correr demos y el piloto en modo práctica) y el adaptador APIsPERU solo está validado contra mocks; falta la primera boleta/factura beta real (`PRIMERA_BOLETA_BETA.md`). La emisión en producción permanece bloqueada hasta definir `BILLING_PRODUCTION_ENABLED=true`.

También falta conectar almacenamiento privado para JSON/XML/PDF/CDR y compartirlos mediante enlaces firmados temporales.

## Documentación

- `docs/PERSISTENCE_MVP.md`
- `docs/MVP_SCREEN_CATALOG.md`
- `docs/BILLING_PROVIDER_ARCHITECTURE.md`
- `docs/SCREEN_MAP.md`
- `docs/AUTHENTICATION.md`
- `docs/ARCHITECTURE.md`
- `docs/API.md`
- `docs/CUSTOMER_LOOKUP.md`
- `docs/IMPLEMENTATION_STATUS.md`
- `docs/SUNAT_RUC_REGISTRY.md`
- `docs/E2E_RUC_TEST.md`

## Demo visual sin instalación

Abra `apps/demo-web/index.html` directamente en un navegador moderno. La demo es autónoma y no se conecta a SUNAT ni a PostgreSQL.

### Frontend persistente 0.6.0

La app móvil ya integra clientes, negocio, catálogo y comprobantes con el backend PostgreSQL multi-tenant. Los clientes nuevos pueden guardarse sin conexión y se sincronizan al volver Internet. El Dashboard muestra métricas persistentes y el POS consulta clientes primero en cache/BD antes de consumir una API externa.

Ver `docs/FRONTEND_PERSISTENCE.md`.


## Proveedores de facturacion 0.9.0

Se agrego una pantalla de configuracion de facturacion electronica y endpoints backend para:

- listar proveedores candidatos;
- elegir proveedor por tenant;
- seleccionar sandbox o produccion;
- guardar referencia de cuenta;
- probar conectividad;
- registrar ultimo estado de prueba;
- mantener tokens y certificados fuera del frontend.

Por seguridad, los proveedores con contrato propio (APIsPERU, NubeFact, Efact, Senda, etc.) usan por ahora un `ConfiguredProviderProbe`: puede verificar configuracion/conectividad, pero **no emite documentos** hasta que exista un adaptador nativo validado con la documentacion y credenciales de sandbox del proveedor elegido. Esto evita enviar por error nuestro JSON canonico a una API con contrato distinto.

Ver `docs/PROVIDER_SELECTION_AND_RFQ.md`.


## Entrega al cliente 0.9.0

El comprobante aceptado puede compartirse mediante:

- WhatsApp con mensaje y enlace prellenados;
- vista web protegida por token firmado;
- representación PDF;
- hoja nativa de compartir;
- correo prellenado.

Los enlaces públicos vencen, no contienen DNI/RUC ni credenciales y se firman con un secreto independiente del JWT. Ver `docs/DOCUMENT_SHARING.md`.


## Entrega al cliente

La cola de entrega automática y su estrategia de reintentos están documentadas en `docs/DELIVERY_QUEUE.md`. En producción no se simula un envío real si no existe un proveedor configurado.


## Consulta RUC oficial 0.11.0

Ejecute `npm run sync:sunat-ruc` para descargar e indexar el Padrón Reducido oficial de SUNAT. El POS y el onboarding consultan ese índice antes de recurrir a un proveedor externo. Ver `docs/SUNAT_RUC_REGISTRY.md`.

## Prueba E2E reproducible (0.11.0)

La version 0.11.0 incorpora un ambiente Docker que prueba el nucleo del MVP contra PostgreSQL 16 real:

```bash
npm run e2e:up
```

Incluye registro multi-tenant, consulta RUC local, DNI con cache, correlativos B001, idempotencia, re-sincronizacion de una venta offline, recuperacion del historial, PDF/enlaces seguros y entrega mock.

Al terminar, limpiar con:

```bash
npm run e2e:down
```

Ver `docs/E2E_ENVIRONMENT.md` para el detalle.
