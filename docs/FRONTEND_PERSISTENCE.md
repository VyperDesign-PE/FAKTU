# Frontend MVP 1.0 conectado a persistencia real

Versión: 0.6.0

## Objetivo

La app móvil ya consume los endpoints persistentes del backend multi-tenant y mantiene una estrategia offline-first para los datos que deben seguir disponibles sin conexión.

## Datos persistentes integrados en frontend

### Negocio
- Se recupera desde `GET /v1/business` al iniciar sesión.
- Los cambios del perfil se guardan localmente y se envían con `PATCH /v1/business` cuando hay conexión.

### Productos
- El catálogo se conserva en AsyncStorage por tenant.
- Cuando hay conexión se sincroniza mediante `GET /v1/products` y `PUT /v1/products/:clientProductId`.
- Los productos creados sin Internet se suben al reconectar.

### Clientes
La búsqueda trabaja en tres niveles:
1. Caché local del dispositivo.
2. PostgreSQL del tenant mediante el backend.
3. Proveedor externo solo si el documento es nuevo.

La pantalla `Customers` permite listar y buscar clientes persistidos. La pantalla `CustomerForm` permite crear/editar datos básicos.

Si un cliente se registra sin Internet:
- queda guardado en la caché local;
- al reconectar, `AppContext` lo sincroniza mediante `POST /v1/customers`.

### Comprobantes
- Las ventas offline quedan en `receiptQueue`.
- Al recuperar conexión se envían al backend mediante `POST /v1/receipts`.
- El historial remoto se recupera desde PostgreSQL con `GET /v1/receipts`.
- La idempotencia se mantiene mediante `clientTransactionId`.

## Dashboard real

La pantalla principal consume datos persistentes para mostrar:
- ventas aceptadas del día;
- total aceptado del día;
- comprobantes pendientes locales;
- consultas de clientes del mes;
- consultas resueltas desde cache;
- consultas externas;
- costo estimado de consultas;
- estado de suscripción;
- estado del proveedor de facturación.

## POS

`POSVentaScreen` incorpora el campo DNI/RUC directamente en la vista principal. El cliente identificado se transfiere al borrador de venta antes de abrir el flujo operativo.

## Rutas agregadas

- `Customers`
- `CustomerForm`

Estas rutas no alteran el shell principal de cuatro secciones: Dashboard, POS/Venta, Historial y Configuración.

## Seguridad multi-tenant

El frontend nunca envía un `tenantId` elegido manualmente para leer o modificar datos del negocio. El backend determina el tenant desde el JWT autenticado.

El token de la API externa de DNI/RUC y las credenciales del proveedor de facturación permanecen exclusivamente en backend/secret manager.
