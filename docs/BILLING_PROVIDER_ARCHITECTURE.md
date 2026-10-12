# Arquitectura desacoplada para proveedor de facturación electrónica

## Objetivo

El dominio del SaaS no debe depender de Nubefact, Facturador.pe, CPE API/APIsPERU u otro proveedor. El backend trabaja con un modelo canónico y un adaptador traduce ese modelo al contrato de cada API externa.

## Capas

1. `server.ts`: autentica, resuelve `tenantId`, valida el request y aplica idempotencia.
2. `BillingService`: caso de uso de emisión.
3. `tenantBillingConfigRepository`: obtiene proveedor y ambiente asignado al tenant.
4. `providerFactory`: construye el adaptador adecuado.
5. `BillingProvider`: contrato estable del dominio.
6. `providers/*`: integración concreta con API externa.

## Contrato canónico

`IssueDocumentCommand` contiene:
- `tenantId`
- `clientTransactionId`
- tipo de documento
- fecha y moneda
- cliente
- ítems
- total

La app móvil no conoce el JSON de Nubefact ni de ningún otro proveedor.

## Idempotencia

`clientTransactionId` es obligatorio. El backend separa el almacenamiento por `tenantId` y lo envía como `Idempotency-Key` cuando el proveedor/gateway lo admite. Si el móvil reintenta por una caída de Internet, el backend debe devolver el mismo resultado y no crear un segundo comprobante.

## Multi-tenancy

El JWT contiene `tenantId`. Toda consulta, emisión, configuración y registro debe filtrar por ese valor. Nunca se acepta un `tenantId` enviado por el cliente como fuente de autorización.

## Secretos

`tenant_billing_settings` guarda referencias, no secretos en texto plano. Para producción, `credential_secret_ref` debe resolver a AWS Secrets Manager, Google Secret Manager, Azure Key Vault u otro almacén de secretos. El MVP usa variables de entorno para el adaptador externo.

## Adaptadores de proveedor

El repositorio incluye:
- `MockBillingProvider`: pruebas locales.
- `ExternalRestBillingProvider`: gateway HTTP con contrato normalizado.

Para conexión directa a un proveedor concreto se debe añadir, por ejemplo:
- `NubefactBillingProvider`
- `FacturadorPeBillingProvider`
- `CpeApiBillingProvider`

Cada uno implementa `BillingProvider` y es responsable exclusivamente de:
1. convertir `IssueDocumentCommand` al payload del proveedor;
2. aplicar su autenticación;
3. interpretar su respuesta;
4. devolver `BillingIssueResult` normalizado;
5. implementar consulta de estado, notas de crédito y bajas cuando entren al alcance.

No se debe llenar `server.ts` con condicionales específicos de proveedor.

## Variables de entorno del adaptador genérico

```env
BILLING_PROVIDER=mock
BILLING_API_BASE_URL=
BILLING_API_TOKEN=
BILLING_ISSUE_PATH=/documents
BILLING_HEALTH_PATH=/health

# También se puede configurar por prefijo:
NUBEFACT_API_BASE_URL=
NUBEFACT_API_TOKEN=
NUBEFACT_ISSUE_PATH=
```

## Flujo de emisión

```text
Móvil
  -> POST /v1/receipts
  -> JWT => tenantId
  -> validación Zod
  -> idempotencia tenant + clientTransactionId
  -> BillingService
  -> configuración del tenant
  -> BillingProvider concreto
  -> API externa / PSE
  -> respuesta normalizada
  -> persistencia
  -> móvil
```

## Requisito antes de producción

El adaptador concreto debe implementarse contra la documentación vigente del proveedor elegido y probarse en sandbox/homologación. La capa genérica no presupone que dos proveedores tengan los mismos campos o endpoints.
