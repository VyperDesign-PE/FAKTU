# Mejoras de experiencia, consistencia y marca

Origen: `REPORTE_APLICACION.md` (12-oct-2026). Cada hallazgo se comprobó en el código antes de tocarlo. Este documento describe lo hecho en el **Bloque B** y deja el punto de continuidad.

## Trazabilidad de los hallazgos 1–24
Estados: **Hecho** (cambio + prueba), **Parcial**, **Pendiente** (sin cambios), **Confirmado** (verificado en código, sin corregir).

| # | Estado | Resultado |
|---|---|---|
| 1 | Hecho | Rutas registradas en `AppRouter.tsx`; "Proveedor y ambiente" entra a `BillingSettings` desde Más. Prueba `tests/navigation.ts` (falla con el router original, pasa ahora). Los permisos de la pantalla de facturación los aplica el servidor (`requireTenantAdmin`); la pantalla muestra el error si no hay permiso. |
| 2 | Parcial | Inicio legado, Historial, Sistema y Sincronización usan `domain/receiptMetrics.ts` (vigente = boleta/factura aceptada y no anulada; por revisar sin duplicar local+remoto). El panel principal usa totales del servidor (`/v1/insights`), que **no se revisaron**: su definición de "ventas de hoy" frente a notas de crédito queda por confirmar. |
| 3 | Hecho | Una cotización del cliente (`domain/pricing.ts`) idéntica a `pricing.ts` de la API; prueba con 500 casos aleatorios contra el servidor. `AppContext`, POS y flujo legado ya la usan. Queda `demo-web` (maqueta, no se tocó). |
| 4 | Pendiente | Umbral 700 PEN y validaciones DNI/RUC siguen repetidos. No son reglas tributarias verificadas. |
| 5 | Confirmado (por el reporte) | El worker no procesa entregas; no se modificó. |
| 6 | Parcial | Etiqueta "Requiere revisión" para ERROR remoto, sin equipararlo a rechazo. Estado terminal tras 12 intentos: pendiente (requiere decisión de negocio). |
| 7 | Pendiente | RLS: alto riesgo; necesita diseño de roles, pooling y worker antes de tocarlo. |
| 8–10 | Pendiente | Cola local, hidratación y catálogo: Bloque C. |
| 11 | Parcial | Tabla única `domain/receiptStatus.ts` usada en Historial, Detalle, Offline y Sistema. Sin migrar: `GuideScreens.tsx` y `EmissionResultScreen`. |
| 12–16 | Pendiente | Migraciones, auditoría, sesión web, caché del service worker, proveedores sin emisión: Bloque D. |
| 17 | Parcial | `README.md` y `app.json` a 0.19.0. Siguen `packages/shared` (0.10.0), sellos de versión en `docs/` y `RUN_E2E_WINDOWS.bat`. |
| 18 | Confirmado | Nadie importa `packages/shared` (`grep @app/shared` en `apps/`); no se eliminó. |
| 19–24 | Pendiente | README sobre mock "bloqueado en producción", ramas fijas en docs, `.env.example`, Dockerfiles y healthcheck, `IMPLEMENTATION_STATUS.md`, código legado. |

Hallazgos nuevos confirmados: (a) el icono instalable y el isotipo de la app eran dos dibujos distintos; (b) el texto de éxito y advertencia no llegaba a contraste AA; (c) controles de 38–41 px; (d) "Faktu" frente a "FAKTU" en textos; (e) menú móvil ("Ventas", "Fiados") distinto al de escritorio ("Comprobantes", "Por cobrar (fiados)").

## Qué cambió para quien usa la app
- Menú móvil: Inicio, Vender, Historial, Por cobrar, Más. Productos, Clientes, Guías, Facturación y Seguridad están en Más.
- Un comprobante con error ya no se cuenta a la vez como "Pendiente" y "Por revisar".
- El IGV mostrado coincide con el del comprobante.
- Nueva identidad (ver `docs/BRANDING.md`).

## Archivos principales
Nuevos: `apps/mobile/src/domain/{receiptMetrics,receiptStatus,pricing}.ts`, `src/brand/{palette,mark}.ts`, `scripts/{sync-palette,generate-icons}.ts`, `tests/{domain,navigation,palette}.ts`.
Modificados: `AppRouter.tsx`, `theme.ts`, `Brand.tsx`, `ResponsiveShell.tsx`, `Ui.tsx`, `HomeScreen.tsx`, `MainSectionScreens.tsx`, `ManagementScreens.tsx`, `OfflineScreens.tsx`, `ReceiptActions.tsx`, `PosScreen.tsx`, `SaleScreens.tsx`, `AppContext.tsx`, `AuthScreens.tsx`, `public/index.html`, `public/manifest.json`, `app.json`, `package.json` (raíz y móvil), `README.md`, `CHANGELOG.md` e iconos PNG.

## Cómo revertir
La carpeta no es un repositorio Git. Hay una copia previa (código fuente, `public/`, `app.json` y `App.tsx` del móvil) en `../_backup_pre_mejoras/`, fuera de `FAKTU-main`. Para revertir, restaura esas rutas sobre `apps/mobile/`. La copia no incluye `package.json`, `README.md`, `CHANGELOG.md` ni `assets/icon.png`, y los archivos nuevos (`tests/`, `scripts/`, `src/brand/`, `src/domain/`) se borran a mano. El icono anterior de 512 px está en `docs/capturas/icono-512-anterior.png`.

## Continuidad
- **Bloque C:** aplicar los tokens a clientes, productos, por cobrar y onboarding; cola local e hidratación (8–10); migrar los estados restantes (11); centralizar validaciones (4).
- **Bloque D:** hallazgos 5, 6, 7, 12–16 y documentación (17–24), con PostgreSQL disponible.
