# Estado de implementacion - 0.12.0

## Implementado

- React Native + Expo + TypeScript.
- React Navigation Native Stack y shell responsivo.
- Login/registro con JWT y sesion segura.
- SaaS multi-tenant con tenant resuelto desde JWT.
- PostgreSQL con migraciones versionadas.
- Persistencia real de negocio, catalogo, clientes, consultas DNI/RUC, series, comprobantes y detalle.
- Cache de clientes: dispositivo -> PostgreSQL -> proveedor externo.
- Índice PostgreSQL del Padrón Reducido RUC oficial de SUNAT.
- Importador streaming del ZIP oficial con SHA-256, fecha de fuente, validación de esquema y mínimo de filas.
- Consulta RUC sin costo API por búsqueda y con respaldo externo opcional.
- Fuente/fecha del padrón visibles en onboarding, POS y Estado del sistema.
- Medicion de consultas externas y costo estimado mensual.
- Series y correlativos atomicos.
- Idempotencia persistente por `tenant_id + client_transaction_id`.
- POS offline con constancia temporal y sincronizacion.
- Frontend de clientes y Dashboard conectado a datos persistidos.
- Capa `BillingProvider` desacoplada.
- Pantalla de configuracion del proveedor de facturacion.
- Seleccion por tenant de proveedor y ambiente sandbox/production.
- Prueba de conectividad desde backend sin exponer tokens en el movil.
- Estado de conexion persistido en `tenant_billing_settings`.
- Adaptador nativo APIsPERU disponible para sandbox; los otros proveedores nombrados continúan bloqueados para emisión hasta tener adaptador específico.
- Generación de representación PDF desde el backend sin dependencia del proveedor.
- Enlaces públicos HMAC firmados, con vencimiento y separación `VIEW`/`PDF`.
- Pantalla real de entrega por WhatsApp, PDF, enlace y correo.
- Regeneración de enlaces desde el historial del comprobante.

- Cola multi-tenant `receipt_deliveries` para separar emisión y entrega.
- Protección explícita contra datos tributarios ficticios en modo demo/mock.
- ShareReceipt conectado al backend real de enlaces firmados.
- Ambiente E2E Docker reproducible con PostgreSQL 16, backend, proveedor documental mock y runner automatico.
- Mapeo nativo APIsPERU para boleta/factura, IGV, cliente, emisor y leyenda SUNAT.
- Conciliación APIsPERU por `invoice/status` para evitar duplicados si se pierde la respuesta del POST.
- Persistencia de hash/XML/CDR/respuesta de proveedor en sandbox.
- Test E2E automatizado para multi-tenant, RUC local, DNI externo/cache, correlativos, idempotencia, re-sincronizacion offline, re-login, PDF y entrega mock.

## Pendiente antes de piloto real

- Completar cotizacion reseller/ISV/API antes de produccion.
- Obtener/configurar una empresa APIsPERU en ambiente beta y ejecutar la primera boleta/factura real de prueba.
- Mover XML/CDR de sandbox a object storage cifrado antes de produccion (en 0.12.0 se preservan temporalmente en PostgreSQL para diagnostico).
- Worker/outbox servidor para retries independientes del celular.
- Refresh tokens y revocacion de sesion.
- Recuperacion de contrasena y OTP reales.
- WhatsApp Business API para envío automático servidor-a-servidor; el MVP ya abre WhatsApp/correo con contenido prellenado.
- Notas de credito/anulacion.
- Backoffice SaaS interno y cobro de suscripciones.
- Rate limiting, auditoria, observabilidad y Secret Manager.
- Ejecutar el E2E Docker en una PC/CI con Docker y conservar el log como evidencia del primer pase integral.
- Ampliar cobertura con pruebas unitarias y casos negativos de integracion.
- Build Android/iOS firmado y pruebas en dispositivos.

## Siguiente hito recomendado

Configurar una empresa APIsPERU en ambiente `beta`, colocar su token solo en backend y ejecutar `npm run test:apisperu-sandbox`. Primero validar conectividad sin emitir; luego, con confirmacion explicita, emitir la primera boleta beta por S/ 1.18. Despues integrar esa credencial al tenant del E2E completo y probar boleta, factura, rechazo, timeout + conciliacion, PDF/XML/CDR y flujo offline.
