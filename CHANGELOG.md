# 0.13.0 - FAKTU: estabilización previa al piloto

Correcciones de la revisión técnica de la 0.12.2.

**Integridad tributaria**
- El servidor recalcula subtotal, IGV y total desde los ítems (`receipts/pricing.ts`). Si el total del celular difiere en más de 1 céntimo responde 422 `TOTAL_MISMATCH`. Antes una venta de S/ 100 podía guardarse como S/ 1.
- Cabecera = suma exacta de líneas, también en el JSON a APIsPERU (antes 3 ítems de S/ 1 daban 2.54 vs 2.55).
- Reglas validadas antes de reservar correlativo (`receipts/documentRules.ts`): factura exige RUC y razón social; boleta > S/ 700 exige identificar al cliente; formato DNI/RUC.

**Emisión segura ante reintentos** (`receipts/receiptIssuer.ts`)
- Si hubo un intento previo (incluido estado ERROR) se concilia antes de reenviar; antes un ERROR se reemitía a ciegas y podía marcar RECHAZADO un comprobante aceptado.
- Reserva atómica del envío: dos peticiones simultáneas no llegan ambas al proveedor.
- Un estado ACEPTADO/RECHAZADO nunca vuelve a PENDIENTE por una respuesta tardía.
- SUNAT 1033 ("registrado previamente") se trata como pendiente de conciliación, no como rechazo.
- Proceso del servidor que concilia/reintenta pendientes con backoff (`RECEIPT_WORKER_*`).
- Códigos HTTP coherentes: 200 aceptado, 202 pendiente, 422 rechazado, 503 error.

**Seguridad**
- El negocio ya no puede elegir `credentialSecretRef` (antes aceptaba `env:JWT_SECRET`). Token propio `BILLING_TOKEN_<tenantId>`; token compartido solo en sandbox con permiso explícito.
- Solo OWNER/ADMIN cambia la configuración de facturación. Producción bloqueada hasta `BILLING_PRODUCTION_ENABLED=true`; simulador bloqueado en producción.
- OTP: en producción ya no acepta cualquier código; queda deshabilitado hasta integrar SMS real.
- Los errores no revelan nombres de variables de entorno.

**App móvil**
- Nuevo estado REJECTED: un comprobante rechazado ya no se muestra como aceptado ni se reintenta sin fin.
- Ventas que quedaron en "Enviando" al cerrar la app vuelven a sincronizarse.
- El total se redondea por línea igual que el servidor.
- Corrige los 4 errores de tipos de `MainSectionScreens.tsx`.

**Producto y calidad**
- Nombre unificado: FAKTU (app, demo web, paquete `pe.faktu.app`).
- `package-lock.json` versionado; pruebas unitarias (`npm test`), integración con PostgreSQL (`npm run test:integration`), E2E sin Docker (`scripts/run-e2e-local.sh`) y CI en GitHub Actions.

# 0.12.2

- Corrige la prueba E2E: la API pública devuelve `status = ACCEPTED` y `sunatStatus = ACEPTADO`; el test antiguo comparaba erróneamente `status` con `ACEPTADO`.
- La prueba valida ahora ambos campos explícitamente.
- `RUN_E2E_WINDOWS.bat` incluye también los logs del contenedor `e2e` en el diagnóstico automático para que un fallo de aserción sea visible.

# 0.12.1

- Corrige la prueba E2E en Docker Desktop/Windows: los healthchecks de Node ya no dependen de `wget` y usan `fetch()` contra `127.0.0.1`.
- Agrega `start_period` a los servicios mock/API para evitar falsos negativos durante el arranque.
- `RUN_E2E_WINDOWS.bat` ahora conserva la ventana abierta y muestra diagnósticos/logs automáticamente si una prueba falla.

## 0.12.0 - Primer adaptador real de facturacion: APIsPERU sandbox

- Implementa `ApiPeruBillingProvider` contra `POST /invoice/send` y `GET /invoice/status`.
- Traduce el modelo canonico a tipoDoc SUNAT 01/03, cliente 1/6/0, IGV 18%, detalle y leyenda 1000.
- Agrega emisor tributario al comando de facturacion y campos ubigeo/departamento/provincia/distrito al tenant.
- Agrega `receipt_provider_artifacts` para preservar hash, XML, CDR ZIP y respuesta de sandbox.
- Agrega conciliacion de comprobantes y endpoint `POST /v1/receipts/:id/reconcile`.
- Un reintento sobre un comprobante PENDIENTE/ENVIANDO consulta estado antes de intentar una nueva emision.
- Agrega referencias de secretos `env:NOMBRE_VARIABLE`; el token no se expone al movil.
- Agrega pruebas `test:apisperu-adapter` y `test:apisperu-sandbox`.
- Documenta checklist para la primera boleta beta real.

## 0.11.0 - Ambiente E2E reproducible

- Agrega `infra/docker-compose.e2e.yml` con PostgreSQL 16, API backend, proveedor documental mock y runner E2E.
- Agrega `infra/Dockerfile.api` para ejecutar el backend y las pruebas en contenedores.
- Agrega proveedor documental HTTP de prueba con contador de llamadas.
- Agrega `apps/api/src/e2e/fullFlow.ts` para validar registro, multi-tenant, RUC local, DNI externo/cache, productos, correlativos, idempotencia, re-sincronizacion offline, persistencia de historial, PDF seguro y cola de entrega.
- Agrega scripts `e2e:up`, `e2e:down` y `test:e2e`.
- Documenta el procedimiento en `docs/E2E_ENVIRONMENT.md`.

# Changelog

## 0.9.0 - Corrección de datos simulados + cola de entrega

- La demo ya no devuelve una empresa ficticia para cualquier RUC ingresado.
- En modo mock solo existen fixtures explícitos (`DNI 00000000` y `RUC 20123456789`) y se muestran como **DATOS SIMULADOS**.
- Un DNI/RUC real ingresado mientras el proveedor está en mock ofrece captura manual en vez de inventar identidad.
- `CustomerDocumentLookupField` informa si el dato proviene de mock, caché del negocio o fuente externa.
- `POST /v1/customers/lookup` vuelve a usar la estrategia real cache-first: PostgreSQL -> proveedor externo.
- Se corrige `server.ts` para utilizar los repositorios PostgreSQL de comprobantes en lugar de un store en memoria obsoleto.
- Se restauran rutas reales de negocio, clientes, productos, historial, configuración de proveedor y enlaces PDF/compartición.
- Migración `003` agrega estado de conexión del proveedor de facturación.
- Nueva migración `004` y tabla `receipt_deliveries` para cola de entrega multi-tenant.
- Nuevo `DeliveryService` con estados WAITING_RECEIPT/PENDING/PROCESSING/SENT/FAILED.
- El valor seguro por defecto es `DELIVERY_PROVIDER=disabled`; no se finge un WhatsApp automático.
- La pantalla Compartir usa el backend real para generar enlaces firmados y abrir WhatsApp/correo/PDF.

## 0.8.0 - PDF, enlace seguro y entrega al cliente

- Se agrega generación de representación PDF del comprobante desde datos persistidos.
- Enlaces públicos firmados HMAC-SHA256 con expiración y propósitos separados `VIEW` / `PDF`.
- Nuevos endpoints autenticados para generar paquetes de compartición por comprobante o `clientTransactionId`.
- Nueva vista pública `/r` y descarga `/r/pdf`, ambas protegidas por token firmado.
- `ShareReceiptScreen` conecta WhatsApp, PDF, enlace nativo y correo.
- Historial puede volver a generar un enlace seguro para un comprobante aceptado.
- No se exponen tokens del PSE, URLs privadas ni credenciales en el móvil.
- Se documenta la diferencia entre abrir WhatsApp con mensaje prellenado y un futuro envío automático mediante WhatsApp Business Platform.
- Variables nuevas: `PUBLIC_APP_BASE_URL`, `PUBLIC_RECEIPT_LINK_SECRET` y `PUBLIC_RECEIPT_LINK_TTL_SECONDS`.

## 0.7.0 - Seleccion y configuracion segura de proveedor

- Nueva pantalla `BillingSettings` para seleccionar proveedor y ambiente por tenant.
- Nuevos endpoints `/v1/billing/providers`, `/v1/billing/settings` y `/v1/billing/test-connection`.
- Se amplian proveedores candidatos: APIsPERU, NubeFact, Efact y Senda.
- Se persiste estado de conexion, ultima prueba y ultimo error.
- Los tokens permanecen solo en backend/Secret Manager; nunca se reciben desde el movil.
- Se agrega `ConfiguredProviderProbe` para impedir emisiones accidentales con un contrato JSON incorrecto.
- `external` queda reservado a gateways que implementen exactamente nuestro contrato canonico.
- Nueva guia `PROVIDER_SELECTION_AND_RFQ.md` para comparar cotizaciones reseller/ISV/API.

## 0.6.0 - Frontend conectado a persistencia real

- Pantallas `Customers` y `CustomerForm` para gestionar clientes por tenant.
- Búsqueda de clientes por DNI/RUC con cache local -> PostgreSQL -> API externa.
- Clientes creados offline se sincronizan automáticamente al recuperar Internet.
- `POSVentaScreen` incorpora búsqueda de cliente y transfiere el cliente al borrador de venta.
- Dashboard consume resumen mensual de consultas, suscripción y estado del proveedor.
- Dashboard y Home calculan las ventas del día usando comprobantes persistidos del backend.
- Configuración incorpora acceso al módulo Clientes.
- API móvil agrega funciones para clientes, resumen de consultas, suscripción y estado del sistema.
- Se mantiene `StyleSheet + theme.ts` para evitar dependencias visuales innecesarias en el MVP.
## 0.5.0 - Persistencia real multi-tenant del MVP

- Se reemplaza `receiptStore` en memoria por persistencia de comprobantes en PostgreSQL.
- Se agregan migraciones versionadas y comando `npm run migrate`.
- Se agregan tablas `customers`, `products`, `document_series`, `receipts`, `receipt_items` y `document_lookup_usage`.
- Se amplía `tenants` con razón social, nombre comercial, dirección, teléfono, estado tributario y onboarding persistente.
- Clientes aislados mediante `tenant_id + document_type + document_number`.
- Búsqueda DNI/RUC cache-first: dispositivo -> PostgreSQL -> proveedor externo.
- Se agrega cache local de hasta 2,000 clientes por tenant para búsquedas offline.
- Consultas externas se registran con costo estimado mensual configurable.
- Se agrega endpoint `/v1/customer-lookups/summary`.
- Catálogo persistido y sincronizado por `clientProductId` para evitar duplicados.
- Series/correlativos se reservan atómicamente en PostgreSQL; no se usa `MAX()+1`.
- Comprobantes guardan snapshot del cliente, subtotal, IGV, total, estado, proveedor y referencias PDF/XML/CDR.
- Idempotencia persistente mediante `tenant_id + client_transaction_id`.
- Historial remoto se recupera al iniciar sesión desde otro dispositivo.
- Perfil y catálogo modificados offline se sincronizan al recuperar Internet.
- El mock de facturación respeta la serie/correlativo persistido (`B001-00000001`, `F001-00000001`, etc.).

## 0.4.2 - Consulta automatizada de clientes DNI/RUC

- Se agrega `consultarDocumentoCliente(tipoDoc, numero)` en backend con validación 8/11 dígitos.
- Integración configurable por variables de entorno con estructura compatible con ApiPeruDev.
- El token del proveedor permanece solo en backend.
- Timeout, normalización de errores y fallback manual.
- Nuevo endpoint autenticado `POST /v1/customers/lookup`.
- Nuevo componente reutilizable `CustomerDocumentLookupField`.
- Búsqueda automática, spinner y entrada manual si falla la consulta.

## 0.4.1 - Demo visual ejecutable

- Demo web autónoma y responsiva.
- Dashboard, POS, historial, configuración y estado del sistema.
- Simulación de modo sin Internet, constancia temporal y sincronización.

## 0.4.0 - Responsive SaaS shell + multi-tenant billing abstraction

- Enrutador central responsivo.
- `tenantId` en JWT.
- `BillingProvider` desacoplado del proveedor externo.
- Tablas base de tenants, memberships, subscriptions y billing settings.

## 0.3.0 - Autenticación y acceso

- Login/registro con validaciones.
- JWT en backend y token en `expo-secure-store`.
- Contraseñas hasheadas con `scrypt`.
- Usuarios persistidos en PostgreSQL.

## 0.2.0 - Mapa de pantallas programado

- React Navigation Native Stack.
- Onboarding, POS, carrito, cliente, resumen, offline, historial y soporte.


## 0.10.0 - 2026-08-28

- Consulta RUC real basada en el Padrón Reducido oficial publicado por SUNAT.
- Nueva tabla global `sunat_ruc_registry`, indexada por RUC, sin mezclarla con los clientes de cada tenant.
- Auditoría de sincronizaciones en `sunat_ruc_import_runs`, incluyendo SHA-256 y fecha de fuente.
- Importador por streaming del ZIP oficial, con decodificación latin-1 y procesamiento por lotes.
- Guardia de esquema: aborta si cambia inesperadamente el formato del padrón.
- Guardia de cantidad mínima antes de depurar registros viejos.
- DNI mantiene estrategia cache-first y proveedor externo solo para clientes nuevos.
- RUC del onboarding y del POS usan el padrón local antes de cualquier respaldo externo.
- La UI identifica explícitamente `Padrón Reducido oficial de SUNAT` y muestra fecha de actualización.
- Nuevo endpoint `/v1/system/ruc-registry/status` para Estado del sistema.
