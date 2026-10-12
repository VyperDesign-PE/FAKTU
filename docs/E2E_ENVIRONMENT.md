# Ambiente E2E - MVP 0.11.0

Esta version agrega un ambiente reproducible para probar el nucleo del MVP de punta a punta con PostgreSQL real dentro de Docker.

## Objetivo

Validar en una sola ejecucion:

1. Crear dos cuentas y dos tenants independientes.
2. Configurar el negocio principal.
3. Resolver un RUC desde el indice local del Padron RUC de SUNAT sin llamar al proveedor externo.
4. Confirmar aislamiento multi-tenant de clientes.
5. Consultar un DNI nuevo contra un proveedor externo de prueba.
6. Consultar el mismo DNI otra vez y confirmar que sale de `CACHE_SERVER`.
7. Verificar que el proveedor externo recibio una sola consulta DNI.
8. Crear un producto.
9. Emitir B001-00000001 con proveedor de facturacion mock.
10. Reintentar la misma transaccion y confirmar idempotencia: sigue siendo B001-00000001.
11. Simular una venta registrada offline y sincronizada luego: B001-00000002.
12. Cerrar/reabrir sesion mediante login y recuperar el historial persistido.
13. Generar enlace seguro y PDF, y validar la firma del PDF.
14. Encolar una entrega por WhatsApp en modo mock y procesarla hasta `SENT`.

## Servicios

`infra/docker-compose.e2e.yml` levanta:

- PostgreSQL 16
- API documental externa simulada
- backend Fastify del MVP
- runner E2E

El servicio documental externo existe solo para demostrar y medir el comportamiento `API -> cache`. No representa RENIEC, SUNAT ni un proveedor comercial.

## Ejecutar

Desde la raiz del proyecto:

```bash
npm run e2e:up
```

Al finalizar correctamente debe aparecer una linea similar a:

```text
[E2E] PASS: register -> tenant -> RUC -> DNI cache -> sale -> idempotency -> offline resync -> PDF -> delivery
```

Para eliminar contenedores y datos de prueba:

```bash
npm run e2e:down
```

## Fixture RUC

El test inserta en la copia local del padron el RUC `20142485878` con la razon social `INSTITUTO DE DESARROLLO URBANO CENCA` para validar el flujo de consulta. Es un fixture E2E; produccion debe cargar el Padron Reducido real mediante `npm run sync:sunat-ruc`.

## Seguridad

- Los secretos E2E son desechables y no deben reutilizarse en produccion.
- El token documental existe solo dentro de la red Docker.
- La API no recibe `tenantId` desde el cliente para autorizar acceso; lo toma del JWT.
- El test verifica que un segundo tenant no pueda leer un cliente del primero.
- El test de idempotencia confirma que reintentar una venta no crea un segundo comprobante.

## Limitacion de este entorno de ChatGPT

El proyecto incluye el ambiente Docker completo, pero el runtime actual donde se genero esta version no dispone del binario Docker/PostgreSQL. Por eso la prueba E2E esta preparada y validada estaticamente, pero debe ejecutarse en una PC o CI con Docker para obtener el resultado de integracion real.
