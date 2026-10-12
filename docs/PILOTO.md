# FAKTU — Guía del piloto

Decisiones de producto, cómo activar a cada negocio y qué revisar antes de pasar a producción.

## 1. Decisiones

### Proveedor de facturación: Nubefact

| Criterio | Nubefact | APIsPERU |
|---|---|---|
| Autorización SUNAT | OSE y PSE | Servicio API (el negocio firma) |
| Certificado digital del negocio | No lo necesita: Nubefact firma como PSE (confirmar con Nubefact al contratar) | Sí, más usuario secundario SOL |
| Cuenta de prueba | Demo gratuita, de inmediato | Empresa beta |
| Modelo para SaaS | Programa reseller: cuenta por negocio, PDF/XML/CDR alojados | Token por empresa |
| PDF oficial (QR + hash) | Lo genera Nubefact | Hay que generarlo |
| Documentación | Manual JSON público y completo | Limitada |

Para un bodeguero, no tener que comprar un certificado digital ni crear usuarios secundarios SOL es la diferencia entre activarse en una tarde o no activarse. FAKTU implementa Nubefact como adaptador nativo (`NubefactBillingProvider`) según el manual oficial. APIsPERU se mantiene como alternativa.

Costo de referencia (página reseller de Nubefact, confirmar con ventas@nubefact.com): S/ 1,000 pago único por la cuenta revendedor y S/ 40 por empresa activa al mes, que incluye 500 comprobantes.

### Web primero (PWA), Android después, con el mismo código

| | App web (PWA) | App Android (tienda) |
|---|---|---|
| Instalación | Un enlace; "Agregar a pantalla de inicio" | Play Store o APK |
| Actualizaciones en el piloto | Instantáneas: corriges un error y todos lo tienen | Revisión de tienda y que cada usuario actualice |
| Computadora del mostrador | Sí | No |
| Sin Internet | Abre y registra ventas (cola local); se sincroniza al volver la conexión | Más robusto en segundo plano |
| Impresora térmica Bluetooth | Limitado | Sí |

Durante un piloto se corrigen cosas cada semana, así que lo que manda es la velocidad de actualización. FAKTU ya compila como PWA desde el mismo código Expo. Cuando el piloto valide el producto, `expo build` genera la app Android sin reescribir nada.

### Tamaño del piloto

- **5 a 10 negocios** durante **4 a 6 semanas**, de 2 o 3 rubros (bodega, librería, menú).
- Primeras 2 semanas en **modo práctica**, en paralelo con su forma actual de vender.
- Luego, activación real negocio por negocio.
- Medir: ventas por día, ventas rechazadas, tiempo por venta, anulaciones y consultas a soporte.

## 2. Modo práctica

Un negocio sin facturación activa usa el simulador con series propias (`TB01`, `TF01`, `TC01`):

- No consume los correlativos reales. Nubefact exige numerar desde 1, sin saltos.
- Nunca se envía a un proveedor real, aunque el negocio se active mientras hay ventas pendientes.
- No aparece en el registro de ventas del contador.
- La app, el comprobante web y el PDF dicen "modo pruebas / sin validez tributaria".

FAKTU **nunca pide la Clave SOL**. La pantalla de activación lo dice explícitamente.

## 3. Activar a un negocio en Nubefact

1. Crear la cuenta del negocio en Nubefact (reseller) y las series `B001`, `F001`, `BC01` y `FC01`. Si usas otras series, cámbialas en `DEFAULT_*_SERIES`.
2. Guiar al negocio para que registre a Nubefact como su PSE en SUNAT Operaciones en Línea.
3. Obtener la ruta y el token de esa cuenta (opción API / Integración).
4. Ejecutar `npm run ops:activation -- correo@negocio.pe`. El script indica:
   - las variables `BILLING_URL_<tenant>` y `BILLING_TOKEN_<tenant>` que hay que definir en el gestor de secretos;
   - el `update` SQL que cambia el negocio a `nubefact`.
5. Reiniciar la API. En la app: Configuración → Facturación → probar conexión.
6. Emitir una boleta de prueba en `sandbox` y revisarla en el panel de Nubefact.

El negocio no puede elegir ni ver la ruta ni el token: si pudiera elegir la ruta, podría enviar el token a un servidor ajeno.

## 4. Homologación con Nubefact (antes de producción)

Nubefact pide emitir desde el sistema un conjunto de documentos. Para el alcance de FAKTU (ventas gravadas en soles), corresponden:

- [ ] Boleta en soles + consulta de estado
- [ ] Factura en soles + consulta de estado
- [ ] Nota de crédito que anula una boleta (botón "Anular venta")
- [ ] Nota de crédito que anula una factura

Fuera del alcance actual, a acordar con Nubefact: dólares, exoneradas/inafectas, exportación, notas de débito y comunicación de baja. Después de la homologación:

1. `BILLING_PRODUCTION_ENABLED=true`
2. Cambiar el negocio a `environment = 'production'`

## 5. Despliegue

```bash
docker build -f infra/Dockerfile -t faktu .
docker run -p 4000:4000 --env-file apps/api/.env faktu
```

- Una sola imagen sirve la API y la app web en el mismo dominio. **HTTPS es obligatorio**: sin él no se instala la PWA ni funciona el modo sin conexión.
- PostgreSQL 16 gestionado, con respaldos diarios.
- Secretos (`JWT_SECRET`, `PUBLIC_RECEIPT_LINK_SECRET`, `BILLING_*`) en el gestor de secretos del proveedor de nube.
- `TRUST_PROXY=true` detrás de un balanceador.
- `npm run sync:sunat-ruc` periódico para el padrón RUC.

## 6. Funciones del piloto

- Venta con medio de pago (efectivo, Yape, Plin, tarjeta, transferencia) y cálculo del vuelto.
- Anulación de una venta con nota de crédito (solo el titular). Es idempotente: no se puede anular dos veces.
- Cierre de caja del día: total neto, efectivo esperado y desglose por medio de pago.
- Registro de ventas mensual en CSV para el contador, con notas de crédito en negativo.
- PDF oficial del proveedor (con QR y hash) al compartir.
- Facturas: la dirección del cliente se completa desde el padrón SUNAT.
- Reintentos en el servidor y conciliación ante respuestas perdidas.

## 7. Riesgos conocidos y pendientes

- **Verificar con la cuenta demo de Nubefact**:
  - el formato de cliente "varios" (`cliente_tipo_de_documento: "-"`);
  - las series de notas de crédito.

  Están implementados según el manual, pero solo se probaron contra un simulador.
- **Propiedad del RUC**: hoy cualquiera puede registrar un RUC no tomado. En el piloto, operaciones verifica la identidad antes de activar. Más adelante conviene validarlo con un código enviado al domicilio fiscal o al correo SUNAT.
- **SMS**: el celular se guarda sin verificar mientras no haya proveedor de SMS.
- **Usuarios cajeros, recuperación de contraseña y suscripciones**: están marcados como "Próximamente" en la app.
- **Archivos XML/CDR**: Nubefact los custodia. FAKTU guarda los enlaces y el hash.
