# Mejoras de experiencia, consistencia y marca

Origen: `REPORTE_APLICACION.md` (12-oct-2026). Cada hallazgo se comprobó en el código antes de tocarlo. Este documento resume lo hecho y deja lo que sigue pendiente.

## Trazabilidad de los hallazgos 1–24
Estados: **Hecho** (cambio + prueba), **Parcial**, **Pendiente** (sin cambios), **Confirmado** (verificado en código, sin corregir).

| # | Estado | Resultado |
|---|---|---|
| 1 | Hecho | Rutas registradas en `AppRouter.tsx`; "Proveedor y ambiente" entra a `BillingSettings` desde Más. Prueba `tests/navigation.ts` (falla con el router original, pasa ahora). Los permisos los aplica el servidor (`requireTenantAdmin`). |
| 2 | Parcial | Inicio legado, Historial, Sistema y Sincronización usan `domain/receiptMetrics.ts` (vigente = boleta/factura aceptada y no anulada; por revisar sin duplicar local y remoto). El panel principal usa totales del servidor (`/v1/insights`), que **no se revisaron**. |
| 3 | Hecho | `domain/pricing.ts` del cliente idéntico a `pricing.ts` de la API; prueba con 500 casos aleatorios. Queda `demo-web` (maqueta, no se tocó). |
| 4 | Hecho | `domain/documentRules.ts`: umbral de 700 PEN, DNI/RUC e "identificar al cliente" en un solo lugar, con prueba cruzada contra `documentRules.ts` de la API. Replican el comportamiento del código; **no se verificaron como norma tributaria**. |
| 5 | Confirmado, sin cambio | El worker no procesa la cola de entregas y `DeliveryService` solo funciona con `DELIVERY_PROVIDER=mock`. Conectarlo marcaría como enviados mensajes que nadie recibe; queda pendiente hasta tener un canal real. |
| 6 | Parcial | Etiqueta "Requiere revisión" sin equipararlo a rechazo. El estado terminal tras 12 intentos requiere una decisión de negocio (cuándo se considera perdido un comprobante); no se inventó. |
| 7 | Pendiente | RLS: alto riesgo; necesita diseño de roles, pooling y worker antes de tocarlo. |
| 8–10 | Hecho | Cola local serializada por negocio (prueba: la versión anterior perdía 24 de 25 ventas simultáneas); número temporal derivado del id único; `ubigeo` se envía; hidratación nunca bloqueada; productos borrados sin conexión no reaparecen (borrados pendientes con reintento); cierres obsoletos corregidos (`user` y `scope` en las dependencias). |
| 11 | Hecho | Tabla única `domain/receiptStatus.ts` usada en historial, detalle, offline, sistema, guías y resultado de emisión. |
| 12 | Hecho | Candado de PostgreSQL (`pg_advisory_lock`) en `runMigrations`. Prueba nueva: 3 procesos migrando a la vez; sin el candado fallan 3 de 3 con `duplicate key`. |
| 13 | Hecho | Auditoría ampliada: reconciliar, compartir, entregas, refrescar bajas y guías, clientes y prueba de conexión. Verificado en el E2E. |
| 14 | Pendiente | Token de sesión web en `localStorage`, clave de bóveda derivada de `JWT_SECRET` si falta `SECRETS_MASTER_KEY`, KMS y PITR: cambios de arquitectura (las cookies exigen CSRF, CORS y refresh). |
| 15 | Hecho | Caché del service worker `faktu-app-v2` (sin esto la app instalada seguiría mostrando los iconos viejos); `/health/*` y `/g/…` ya no se cachean. |
| 16 | Hecho | El catálogo de proveedores indica `canIssue`; Efact y Senda no se pueden elegir (el servidor responde 409; verificado en el E2E) y la app los muestra como no disponibles. El stub `POST /v1/pse/authorization-session` y el OTP de desarrollo siguen igual. |
| 17 | Parcial | `README.md` y `app.json` a 0.19.0. Siguen `packages/shared` (0.10.0) y sellos de versión antiguos en docs históricos. |
| 18 | Confirmado | Nadie importa `packages/shared`; no se eliminó (decisión del equipo). |
| 19 | Hecho | El README describe el valor real de `ALLOW_MOCK_BILLING` (por defecto `true`). |
| 20 | Hecho | Referencias a `faktu-0.13-estabilizacion` sustituidas por "la rama que despliegues (por defecto `main`)". |
| 21 | Hecho | `.env.example` de la raíz apunta al de `apps/api`; este lista `SECRETS_MASTER_KEY`, `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_DAYS`, `CORS_ORIGINS`, `ALERT_WEBHOOK_URL` y `DEMO_*`, y quita variables Nubefact duplicadas. |
| 22 | Parcial | El `HEALTHCHECK` de `infra/Dockerfile` usa `PORT` o `API_PORT`. `infra/Dockerfile.api` (solo compose E2E) sin cambios. |
| 23 | Hecho | `docs/IMPLEMENTATION_STATUS.md` ya no lista como pendiente lo implementado. |
| 24 | Pendiente | Flujo de venta legado y `starterCatalog`: se conservan hasta inventariar entradas y pruebas. |

Hallazgos nuevos confirmados: (a) el icono instalable y el isotipo de la app eran dos dibujos distintos; (b) el texto de éxito y de advertencia no llegaba a contraste AA; (c) controles de 38–41 px; (d) "Faktu" frente a "FAKTU" en textos; (e) el menú móvil ("Ventas", "Fiados") difería del de escritorio; (f) `/health/ready` se podía servir desde la caché del service worker; (g) arrancar API y worker a la vez con `DB_AUTO_MIGRATE=true` fallaba con `duplicate key`.

## Qué cambió para quien usa la app
- Menú móvil: Inicio, Vender, Historial, Por cobrar, Más. Productos, Clientes, Guías, Facturación y Seguridad están en Más.
- Un comprobante con error ya no se cuenta a la vez como "Pendiente" y "Por revisar".
- El IGV mostrado coincide con el del comprobante.
- Una venta hecha mientras se sincroniza ya no puede perderse.
- Un producto borrado sin conexión no reaparece.
- Nueva identidad (ver `docs/BRANDING.md`).

## Cómo revertir
Todo está en la rama `mejoras-ux-marca` con commits separados (marca y navegación, cliente, servidor y documentación). Para deshacer un cambio basta `git revert <commit>`. Ningún cambio toca el esquema de la base de datos: `runMigrations` solo añade un candado, sin migraciones nuevas.

## Continuidad
- Pendiente de decisión de negocio: estado terminal tras 12 intentos (6) y canal real de entregas (5).
- Pendiente de arquitectura: RLS (7), sesión web sin `localStorage` y KMS (14).
- Limpieza: flujo de venta legado (24), `packages/shared` (17–18).
- Visual: recorrer onboarding, clientes, productos y por cobrar con la API real; variante monocromática del logo.
