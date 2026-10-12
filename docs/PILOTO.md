# FAKTU — Guía del piloto

Decisiones de producto, cómo activar a cada negocio y qué revisar antes de pasar a producción.

## 1. Decisiones

### Proveedor de facturación: APIsPERU para el piloto, Nubefact para escalar

Comparación con precios publicados (confirmar antes de contratar):

| | APIsPERU | Nubefact (TXT-JSON) | Nubefact revendedor |
|---|---|---|---|
| Por negocio al mes | S/ 25 + IGV, ilimitado (plan gratis: 200 comprobantes) | S/ 70 con IGV (500 comprobantes) | ~S/ 40 (cotizar) |
| Pago inicial | S/ 0 | S/ 0 | ~S/ 1,000 |
| Certificado digital | Lo aporta el negocio | Incluido | Incluido (confirmar) |
| Usuario SOL secundario | Sí, del negocio | No | No |
| PDF oficial | `POST /invoice/pdf` (FAKTU lo sirve en el enlace compartido) | Enlace alojado | Enlace alojado |

**Piloto: APIsPERU.** No hay pago inicial, el plan gratis sirve para las pruebas y el costo por negocio es el más bajo. A cambio, cada negocio necesita certificado digital y un usuario SOL secundario.

**Nubefact queda listo como alternativa.** El adaptador existe y está probado. Conviene pasar a Nubefact si el certificado o el usuario secundario resultan un obstáculo en el piloto, o al superar unos 30 negocios con el plan revendedor.

**El plan "Integración TXT-JSON" de Nubefact a S/ 70 no sirve para revender:** cuesta lo mismo que "Nubefact Online", que es la competencia directa.

Ambos adaptadores siguen la documentación oficial: OpenAPI de APIsPERU en `https://facturacion.apisperu.com/doc/swagger` y manual JSON de Nubefact. Por ahora solo se probaron contra simuladores; falta la primera emisión real en beta.

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

## 3. Activar a un negocio

Ejecuta `npm run ops:activation -- correo@negocio.pe apisperu` (o `nubefact`). El script indica los pasos, la variable de secreto exacta y si faltan datos del emisor: RUC, razón social, dirección fiscal y ubigeo. La dirección y el ubigeo se completan solos desde el padrón SUNAT cuando el RUC está ahí.

### APIsPERU (piloto)

1. **Certificado digital del negocio.** Para las pruebas en beta, APIsPERU genera uno de prueba (`POST /companies/certificate/free`). Para producción se necesita uno real del negocio.
2. **Usuario SOL secundario.** El negocio lo crea en SUNAT Operaciones en Línea con permiso **solo de emisión electrónica**.
   - FAKTU nunca pide la Clave SOL principal.
   - El usuario secundario se ingresa directamente en APIsPERU, no se guarda en FAKTU, y el negocio puede desactivarlo cuando quiera.
3. **Registrar la empresa** en el panel de APIsPERU con entorno `beta`. Copiar el token de esa empresa a `BILLING_TOKEN_<tenant>` en el gestor de secretos del servidor.
4. **Cambiar el negocio a `apisperu` / `sandbox`** con el `update` que imprime el script. Reiniciar la API.
5. **En la app:** probar conexión, emitir una boleta de S/ 1, compartirla (debe abrir el PDF oficial con QR) y anularla.
6. **Producción:**
   - pasar la empresa a `produccion` en APIsPERU;
   - definir `BILLING_PRODUCTION_ENABLED=true`;
   - cambiar el negocio a `environment = 'production'`.

**Manejo seguro de credenciales:** el certificado y la clave del usuario secundario solo los recibe la persona de operaciones que registra la empresa. Se entregan por un canal seguro, nunca por un grupo de chat, y se borran de ese canal una vez registrados.

### Nubefact (alternativa)

1. Crear la cuenta del negocio con las series `B001`, `F001`, `BC01` y `FC01`.
2. Definir `BILLING_URL_<tenant>` y `BILLING_TOKEN_<tenant>`.
3. Cambiar el negocio a `nubefact` con el `update` del script.

El negocio no puede elegir ni ver la ruta ni el token.

## 4. Pruebas en beta antes de producción

Con APIsPERU en `beta` (y en la homologación de Nubefact si se usa), emitir y verificar:

- [ ] Boleta en soles + consulta de estado
- [ ] Factura en soles + consulta de estado
- [ ] Nota de crédito que anula una boleta (botón "Anular venta")
- [ ] Nota de crédito que anula una factura

Fuera del alcance actual, a acordar con Nubefact: dólares, exoneradas/inafectas, exportación, notas de débito y comunicación de baja. Después de la homologación:

1. `BILLING_PRODUCTION_ENABLED=true`
2. Cambiar el negocio a `environment = 'production'`

## 4b. Documentos que emite FAKTU

| Documento | Cómo se usa en la app | Reglas |
|---|---|---|
| Boleta / factura | Nueva venta | Factura con RUC y dirección; boleta > S/ 700 identificada |
| Nota de crédito | Detalle → Corregir o anular → Nota de crédito | 01/02/06 por el total (una sola vigente); 07 devolución por producto; 09 descuento. Nunca supera el saldo |
| Nota de débito | Detalle → Nota de débito | Intereses, aumento de valor, penalidades |
| Comunicación de baja | Detalle → Dar de baja | Solo si no se entregó al cliente, sin notas y dentro de 7 días. Si no, nota de crédito |
| Resumen diario de baja (boletas) | Automático al dar de baja una boleta | Nubefact lo gestiona; con APIsPERU lo envía FAKTU |
| Guía de remisión remitente / transportista | Configuración → Guías, o desde una venta | Transporte público: RUC del transportista. Privado: placa y conductor. Aceptación asíncrona |

**APIsPERU y guías:** desde 2023, SUNAT emite las guías por una API propia. Al registrar la empresa en APIsPERU hay que completar `client_id` y `client_secret`, que se generan en el portal de SUNAT (tutorial en el panel de APIsPERU). Sin esos datos, las facturas y boletas funcionan, pero las guías no.

**Verificar en beta:** una baja de factura, una baja de boleta (resumen) y una guía de cada tipo. Los adaptadores siguen los manuales oficiales, pero solo se probaron contra simuladores.

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
