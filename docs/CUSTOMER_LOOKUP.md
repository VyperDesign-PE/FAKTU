# Consulta automatizada de clientes — DNI / RUC

## Objetivo

Autocompletar los datos del cliente en el POS sin exponer credenciales, reducir el costo de consultas DNI y usar una fuente oficial gratuita para RUC.

## DNI — cache-first

1. El cajero completa 8 dígitos.
2. El móvil busca primero en su cache local del tenant.
3. Si no existe y hay Internet, llama a `POST /v1/customers/lookup`.
4. El backend busca `tenant_id + DNI + numero` en `customers`.
5. Solo si el DNI es nuevo consulta el proveedor externo.
6. Guarda el resultado en PostgreSQL y en el celular.
7. Si la API falla, permite escribir el nombre manualmente.

```text
Dispositivo -> customers PostgreSQL -> API DNI
     0                 0             costo solo si es nuevo
```

## RUC — Padrón oficial SUNAT

Para RUC el orden cambia porque el Padrón Reducido oficial de SUNAT se sincroniza a nuestra infraestructura y no tiene costo por consulta individual:

```text
Padrón SUNAT local -> customer cache del tenant -> proveedor externo opcional
      S/ 0                    S/ 0                  solo respaldo
```

Al encontrar un RUC en `sunat_ruc_registry`, el backend:

- devuelve razón social, estado, condición y domicilio reconstruido;
- muestra `source = SUNAT_RUC_PADRON`;
- informa `sourceUpdatedAt` cuando está disponible;
- guarda/actualiza el cliente dentro del tenant;
- registra `external_lookup = false` y costo `0`.

Consultar `docs/SUNAT_RUC_REGISTRY.md` para la ingesta diaria.

## Ahorro y métricas

El backend registra cada lookup en `document_lookup_usage` y permite obtener el resumen mensual mediante:

```text
GET /v1/customer-lookups/summary
```

El costo estimado de DNI se configura con:

```env
DOCUMENT_LOOKUP_DNI_COST_PEN=0
```

El respaldo externo de RUC, si algún día tiene costo, puede registrarse con:

```env
DOCUMENT_LOOKUP_RUC_COST_PEN=0
```

## Seguridad

- `DOCUMENT_LOOKUP_API_TOKEN` vive exclusivamente en backend.
- No usar variables `EXPO_PUBLIC_*` para secretos.
- El DNI/RUC se envía en body POST en la búsqueda de clientes.
- `tenantId` proviene del JWT.
- `customers` tiene restricción única por tenant y documento.
- `sunat_ruc_registry` es un índice global de datos públicos oficiales, no una cartera de clientes compartida.
- Evitar registrar DNI/RUC completos en logs de aplicación.

## Backend

Proveedor DNI/respaldo externo:

`apps/api/src/modules/customerLookup/consultarDocumentoCliente.ts`

Orquestador multi-fuente:

`apps/api/src/modules/customerLookup/customerLookupService.ts`

RUC oficial:

`apps/api/src/modules/customerLookup/rucLookupService.ts`

`apps/api/src/modules/sunatRuc/sunatRucRegistryRepository.ts`

Repositorio de clientes:

`apps/api/src/modules/customers/customerRepository.ts`

## Frontend

Cliente API:

`apps/mobile/src/services/api.ts`

Cache local:

`apps/mobile/src/storage/customerCache.ts`

Componente reutilizable:

`apps/mobile/src/components/customer/CustomerDocumentLookupField.tsx`

## Fallback

La búsqueda nunca debe bloquear la venta. Si un DNI/RUC no se encuentra o una fuente está temporalmente indisponible, el nombre o razón social queda editable para ingreso manual. Si la venta se realiza offline, el comprobante queda en la cola local y se sincroniza posteriormente.
