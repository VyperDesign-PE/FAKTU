# Primera boleta beta - pasos mínimos

La version 0.12.0 ya contiene el adaptador nativo de APIsPERU. Para ejecutar la primera emision real en ambiente de pruebas hace falta una **empresa configurada en beta dentro de APIsPERU** y su **token de empresa**.

## 1. No pegues el token en el codigo ni en el movil

Guárdalo solo como variable de entorno del backend.

## 2. Completa estas variables

```env
APISPERU_API_BASE_URL=https://facturacion.apisperu.com/api/v1/
APISPERU_API_TOKEN=TU_TOKEN_DE_EMPRESA_BETA
APISPERU_SANDBOX_RUC=TU_RUC_DE_PRUEBA
APISPERU_SANDBOX_LEGAL_NAME=TU_RAZON_SOCIAL
APISPERU_SANDBOX_ADDRESS=TU_DIRECCION
APISPERU_SANDBOX_UBIGEO=150101
APISPERU_SANDBOX_DEPARTMENT=LIMA
APISPERU_SANDBOX_PROVINCE=LIMA
APISPERU_SANDBOX_DISTRICT=LIMA
APISPERU_SANDBOX_SERIES=B001
APISPERU_SANDBOX_CORRELATIVE=1
```

> `APISPERU_API_TOKEN` lo usa solo el script `test:apisperu-sandbox`. Para emitir desde la app, la API usa el token del negocio en `BILLING_TOKEN_<tenantId>` (o, solo en sandbox, `APISPERU_API_TOKEN` con `BILLING_ALLOW_SHARED_SANDBOX_TOKEN=true`). Ver `docs/APISPERU_SANDBOX.md`.

## 3. Primero prueba solo conectividad

```bash
npm install
npm run test:apisperu-adapter
npm run test:apisperu-sandbox
```

La prueba real no emite nada mientras `APISPERU_SANDBOX_CONFIRM` no sea `YES`.

## 4. Primera emisión beta

Solo después de confirmar que la empresa está configurada en `beta`:

```env
APISPERU_SANDBOX_CONFIRM=YES
```

Ejecuta nuevamente:

```bash
npm run test:apisperu-sandbox
```

Se intentará emitir una **BOLETA B001** por **S/ 1.18** con un producto de prueba. Si el POST queda incierto por red, el script puede consultar posteriormente `invoice/status`; el backend 0.12.0 aplica la misma estrategia y no reemite a ciegas.

## 5. Evidencia a conservar

- estado SUNAT,
- serie/correlativo,
- hash,
- XML,
- CDR,
- mensaje del proveedor,
- hora de la prueba.

No habilitar producción hasta completar el checklist en `docs/SANDBOX_CHECKLIST.md`.
