# Arquitectura MVP 1.0 — versión 0.5.0

## Principio rector

El usuario debe poder **seguir vendiendo aunque falle Internet**. La complejidad tributaria, de sincronización y de persistencia vive detrás de una interfaz sencilla.

## Capas

```text
APP MÓVIL (Expo)
  │
  ├─ SecureStore: sesión
  ├─ AsyncStorage: perfil/cache/catálogo/cola offline
  └─ NetInfo: reconexión automática
        │
        ▼
API BACKEND (Fastify)
  │
  ├─ JWT -> tenantId
  ├─ Auth
  ├─ Clientes
  ├─ Productos
  ├─ Comprobantes
  └─ BillingProvider
        │
        ├──────── PostgreSQL
        │          ├─ tenants
        │          ├─ customers
        │          ├─ products
        │          ├─ document_series
        │          ├─ receipts/items
        │          └─ lookup usage
        │
        └──────── PSE/API externa -> SUNAT
```

## Multi-tenancy

Toda operación de negocio se filtra por el `tenantId` que llega firmado dentro del JWT.

Regla obligatoria:

```text
Repositorio = tenantId + criterio funcional
```

Nunca se ejecutan búsquedas de clientes, productos o comprobantes únicamente por documento/id sin verificar el tenant.

## Autenticación

1. Usuario crea cuenta o ingresa.
2. Contraseña se valida con Zod y se almacena como `scrypt + salt`.
3. API entrega JWT con `sub`, `email` y `tenantId`.
4. App guarda el JWT en `expo-secure-store`.
5. Backend obtiene el tenant desde la sesión autenticada.

## Persistencia offline + servidor

La app mantiene datos locales para operar sin red, mientras PostgreSQL es la fuente central para recuperar información entre dispositivos.

### Comprobantes

1. El celular crea `clientTransactionId`.
2. Guarda venta y constancia `VT-XXXXXX` localmente.
3. Al tener Internet envía `/v1/receipts`.
4. PostgreSQL verifica idempotencia.
5. Reserva serie/correlativo dentro de una transacción.
6. Persiste cabecera y líneas antes de llamar al proveedor.
7. `BillingProvider` procesa el comprobante.
8. PostgreSQL persiste aceptación, rechazo, error o pendiente.
9. El celular actualiza su cola y refresca historial remoto.

### Clientes

```text
cache dispositivo
      ↓ miss
customers PostgreSQL del tenant
      ↓ miss
API externa DNI/RUC
      ↓
guardar en PostgreSQL + cache dispositivo
```

Esto reduce el número de consultas pagadas y permite recuperar clientes conocidos sin Internet.

## Series e idempotencia

- `UNIQUE (tenant_id, client_transaction_id)` evita duplicidad de una misma venta.
- `UNIQUE (tenant_id, document_type, series, correlative)` evita duplicidad de numeración.
- `document_series` reserva correlativos mediante `UPDATE ... RETURNING` en transacción.

## Seguridad

- Clave SOL nunca se persiste.
- Token del proveedor externo nunca se expone a Expo.
- Credenciales de facturación deben vivir en Secret Manager; la BD guarda una referencia.
- TLS obligatorio en producción.
- Los archivos tributarios se moverán a storage privado con URLs firmadas temporales.
- Se recomienda PostgreSQL Row Level Security como segunda barrera en una etapa posterior.

## Próximo endurecimiento de producción

- worker/outbox para reintentos del servidor;
- refresh token y revocación;
- rate limiting;
- logs de auditoría;
- Secret Manager;
- storage privado JSON/XML/PDF/CDR;
- pruebas de integración con PostgreSQL real;
- adaptador específico del proveedor de facturación elegido.
