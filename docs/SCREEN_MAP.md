# Mapa de pantallas — MVP 1.0 programado

Stack móvil: **React Native + Expo + TypeScript + React Navigation (Native Stack)**.

La iteración 0.3.0 registra **34 rutas tipadas**.

## Acceso

| # | Ruta | Pantalla | Estado |
|---|---|---|---|
| 01 | `Login` | Ingreso con correo y contraseña | Programada + API + sesión segura |
| 02 | `Register` | Crear cuenta | Programada + API + validaciones |

## Onboarding

| # | Ruta | Pantalla | Estado |
|---|---|---|---|
| 03 | `Welcome` | Bienvenida | Programada |
| 04 | `VerifyPhone` | Verificar celular | Programada |
| 05 | `OtpCode` | Código OTP | Programada + API mock |
| 06 | `EnterRuc` | Ingresar RUC | Programada |
| 07 | `ConfirmBusiness` | Confirmar negocio | Programada + consulta mock |
| 08 | `SunatConnectionData` | RUC / Usuario SOL / Clave SOL | Programada; la clave no se persiste |
| 09 | `AuthorizePse` | Autorizar PSE | Programada + sesión mock |
| 10 | `Authorizing` | Autorizando | Programada |
| 11 | `EnabledDocuments` | Comprobantes habilitados | Programada |
| 12 | `Ready` | Todo listo | Programada + persistencia de onboarding |

## Uso diario

| # | Ruta | Pantalla | Estado |
|---|---|---|---|
| 13 | `Home` | Inicio + Estado del sistema | Programada |
| 14 | `NewSale` | Nueva venta | Programada |
| 15 | `AddProduct` | Agregar producto/servicio | Programada + catálogo local |
| 16 | `QuickSale` | Venta rápida/manual | Programada |
| 17 | `Cart` | Carrito | Programada |
| 18 | `DocumentType` | Tipo de comprobante | Programada |
| 19 | `CustomerData` | Datos del cliente | Programada + DNI/RUC mock + modo offline |
| 20 | `SaleSummary` | Resumen | Programada |
| 21 | `EmissionResult` | Resultado de emisión | Programada |
| 22 | `ShareReceipt` | Compartir comprobante | UI programada; canales reales pendientes |

## Sin Internet

| # | Ruta | Pantalla | Estado |
|---|---|---|---|
| 23 | `OfflineHome` | Inicio sin Internet | Programada |
| 24 | `OfflineSale` | Venta offline | Programada |
| 25 | `TemporaryReceipt` | Constancia temporal | Programada |
| 26 | `PendingReceipts` | Pendientes de envío | Programada |
| 27 | `Syncing` | Sincronizando | Programada |
| 28 | `SyncResult` | Resultado de sincronización | Programada |

## Gestión

| # | Ruta | Pantalla | Estado |
|---|---|---|---|
| 29 | `Catalog` | Mi catálogo | Programada |
| 30 | `ReceiptHistory` | Historial de comprobantes | Programada |
| 31 | `ReceiptDetail` | Detalle de comprobante | Programada |
| 32 | `SystemStatus` | Estado del sistema | Programada |
| 33 | `Business` | Mi negocio | Programada + cuenta + cerrar sesión |
| 34 | `Support` | Ayuda / soporte | Programada |

## Flujo principal

```text
Login -> INGRESAR -> Home
  |
  +-> REGISTRARME -> Register -> VerifyPhone -> OtpCode -> EnterRuc
                       -> ConfirmBusiness -> SunatConnectionData
                       -> AuthorizePse -> Authorizing -> EnabledDocuments
                       -> Ready -> Home

Home
  -> NewSale -> Cart -> DocumentType -> CustomerData -> SaleSummary
       |                                             |
       +-> AddProduct                                +-> online -> EmissionResult -> ShareReceipt
       +-> QuickSale                                 +-> offline -> TemporaryReceipt

TemporaryReceipt -> PendingReceipts -> Syncing -> SyncResult
Home -> Catalog / ReceiptHistory / SystemStatus / Business / Support
```
