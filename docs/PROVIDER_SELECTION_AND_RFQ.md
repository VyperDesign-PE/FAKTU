# Seleccion de proveedor de facturacion - MVP 1.0

## Objetivo

Elegir un proveedor de facturacion electronica para el piloto sin acoplar el SaaS a una sola empresa. El criterio principal no es solo el precio publico: debemos comparar costo por RUC, costo por CPE, soporte, SLA, alta automatizada, modalidad reseller/ISV, marca blanca, portabilidad y tratamiento de credenciales/certificados.

## Proveedores candidatos

- APIsPERU
- NubeFact
- Efact
- Senda
- Otros proveedores PSE/API compatibles con el modelo SaaS

La aplicacion mantiene un contrato interno `BillingProvider`. Cada proveedor real debera tener su propio adaptador que traduzca nuestro modelo canonico al JSON/SOAP/TXT del proveedor y normalice su respuesta.

## Regla de seguridad

Hasta completar la homologacion tecnica de un proveedor, el sistema no enviara comprobantes reales a su endpoint. La configuracion puede probar conectividad, pero la emision seguira en `mock` o sandbox controlado.

Los tokens, certificados, claves y secretos:

- no se almacenan en la aplicacion movil;
- no se devuelven por la API;
- deben vivir en variables seguras para piloto o, preferentemente, Secret Manager en produccion;
- `tenant_billing_settings` almacena solo referencias y estado de conexion.

## Matriz para decidir

| Criterio | Peso sugerido |
|---|---:|
| Costo real por RUC activo | 25% |
| Costo/limite de CPE y exceso | 15% |
| API y calidad de documentacion | 15% |
| SLA, soporte e incidencias | 10% |
| Modalidad reseller/ISV/marca blanca | 10% |
| Alta automatizada de nuevos RUC | 10% |
| Custodia de certificados/credenciales | 5% |
| PDF/XML/CDR y consulta de estado | 5% |
| Portabilidad y condiciones de salida | 5% |

## Escenarios que deben cotizar

Solicitar el mismo cuadro a todos los proveedores:

- 100 RUC activos;
- 500 RUC activos;
- 1,000 RUC activos;
- 5,000 RUC activos;
- 300 CPE/mes por RUC;
- 500 CPE/mes por RUC;
- 1,000 CPE/mes por RUC.

## Solicitud de cotizacion estandar

Somos desarrolladores de una plataforma SaaS multi-tenant de facturacion electronica dirigida a pequenos negocios en Peru. Solicitamos propuesta comercial y tecnica para modalidad API/PSE/ISV/Reseller.

Por favor indicar:

1. costo mensual por RUC o bolsa global;
2. volumen de CPE incluido;
3. costo de exceso por CPE;
4. descuentos por 100, 500, 1,000 y 5,000 RUC activos;
5. existencia de sandbox o ambiente demo;
6. SLA y canales/horarios de soporte;
7. API REST/SOAP/TXT/JSON disponible;
8. devolucion o almacenamiento de PDF, XML y CDR;
9. notas de credito, debito, anulaciones y contingencias;
10. alta automatizada de nuevos RUC;
11. modalidad marca blanca/reseller;
12. si el proveedor mantiene relacion comercial solo con nosotros o puede contactar directamente a nuestros clientes;
13. custodia de certificados y credenciales SUNAT/SOL;
14. mecanismo de rotacion y revocacion de credenciales;
15. portabilidad de XML/PDF/CDR y datos al terminar el contrato;
16. limites, rate limits y costos de consultas de estado;
17. cambios de precio por crecimiento de cartera.

## Preguntas eliminatorias

Antes de seleccionar proveedor debemos tener respuesta clara a estas preguntas:

- Quien firma el XML?
- Donde vive el certificado digital?
- Se requiere almacenar usuario/clave SOL? Si si, como se protege?
- Podemos dar de alta un nuevo RUC por API o requiere trabajo manual?
- Que ocurre si el proveedor esta caido?
- Podemos reintentar una operacion con idempotencia sin duplicar comprobantes?
- Como consultamos el estado de un documento si la respuesta inicial se pierde?
- Que archivos recibimos y cuanto tiempo se conservan?
- Podemos exportar toda la informacion al terminar la relacion comercial?

## Decision para el codigo actual

El MVP 0.7.0 permite elegir proveedor y ambiente por tenant, guardar una referencia de cuenta y probar conectividad. Todavia no activa emision real en proveedores nombrados hasta implementar y probar su adaptador nativo.

El flujo de desarrollo recomendado es:

1. obtener credenciales sandbox del proveedor elegido;
2. implementar el mapper de request;
3. implementar normalizacion de response;
4. agregar consulta de estado del comprobante;
5. probar factura y boleta aceptada;
6. probar error de validacion;
7. probar timeout y retry idempotente;
8. probar PDF/XML/CDR;
9. homologar notas/anulaciones;
10. habilitar produccion solo despues de pasar la bateria E2E.
