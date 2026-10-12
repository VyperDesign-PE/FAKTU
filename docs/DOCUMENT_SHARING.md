# PDF, enlace seguro y WhatsApp - MVP 0.8.0

## Objetivo

Después de que un comprobante queda `ACEPTADO`, el comercio puede entregar al cliente una representación PDF y un enlace web protegido sin exponer tokens del PSE/API ni rutas privadas de almacenamiento.

## Flujo

1. POS emite y sincroniza el comprobante.
2. PostgreSQL conserva el comprobante y su detalle.
3. La app solicita `POST /v1/receipts/by-transaction/:clientTransactionId/share`.
4. El backend verifica `tenantId` desde el JWT y que el comprobante esté aceptado.
5. El backend genera dos tokens HMAC con vencimiento: `VIEW` y `PDF`.
6. La app recibe `viewUrl`, `pdfUrl` y el texto preparado para WhatsApp/correo.
7. El cliente abre `/r?t=...` sin iniciar sesión. El servidor valida firma, propósito y expiración antes de leer el comprobante.
8. `/r/pdf?t=...` genera una representación PDF desde los datos persistidos.

## Seguridad

- El token público no contiene DNI, RUC, nombre ni importes: solo IDs internos, propósito y expiración.
- Firma HMAC-SHA256 con `PUBLIC_RECEIPT_LINK_SECRET`.
- `timingSafeEqual` para validar la firma.
- Propósitos separados: un token `VIEW` no sirve para descargar PDF.
- Expiración configurable mediante `PUBLIC_RECEIPT_LINK_TTL_SECONDS`.
- Las respuestas usan `Cache-Control: private, no-store` y la vista usa `X-Robots-Tag: noindex, nofollow`.
- El endpoint que crea enlaces es autenticado y siempre toma el tenant del JWT.
- `PUBLIC_APP_BASE_URL` debe ser HTTPS en producción.

## PDF

Para no introducir una dependencia adicional en el MVP, el backend contiene un generador PDF mínimo basado en PDF 1.4 y fuentes estándar Helvetica/Helvetica-Bold. Incluye:

- datos del negocio;
- RUC;
- tipo y número del comprobante;
- fecha;
- cliente;
- detalle;
- subtotal;
- IGV;
- total;
- leyenda de representación impresa.

Cuando se active un PSE real, el adaptador podrá conservar el PDF original del proveedor. El enlace seguro puede seguir apuntando a nuestra capa, evitando exponer directamente URLs del proveedor.

## WhatsApp

El MVP abre WhatsApp mediante un enlace `wa.me` con un mensaje prellenado. Si no puede abrirse, usa el `Share` nativo del dispositivo.

Esto **no equivale a envío automático servidor-a-servidor**. Para enviar WhatsApp automáticamente después de una sincronización offline se requiere integrar oficialmente WhatsApp Business Platform/Cloud API, consentimiento del destinatario y las reglas aplicables de plantillas/mensajería. Esa integración queda desacoplada para una siguiente iteración.

## Endpoints

- `POST /v1/receipts/by-transaction/:clientTransactionId/share`
- `POST /v1/receipts/:id/share`
- `GET /r?t=<signed-token>`
- `GET /r/pdf?t=<signed-token>`

## Variables de entorno

```env
PUBLIC_APP_BASE_URL=https://comprobantes.midominio.pe
PUBLIC_RECEIPT_LINK_SECRET=<secreto-aleatorio-largo>
PUBLIC_RECEIPT_LINK_TTL_SECONDS=2592000
```

No reutilizar `JWT_SECRET` como secreto de enlaces públicos. Deben rotarse y administrarse por separado.
