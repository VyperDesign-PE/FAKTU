# Cola de entrega al cliente - MVP 0.9.0

## Objetivo

Separar la emisión tributaria de la entrega al cliente. Una boleta/factura puede quedar aceptada aunque WhatsApp, SMS o correo tengan una incidencia temporal.

Flujo:

1. El POS registra/emite el comprobante.
2. Si el usuario solicita entrega automática, se crea un registro en `receipt_deliveries`.
3. Si el comprobante aún no está aceptado, la entrega queda `WAITING_RECEIPT`.
4. Al quedar `ACEPTADO`, las entregas pasan a `PENDING`.
5. Un worker llama `DeliveryService.processPending()`.
6. El adaptador del canal marca `SENT` o `FAILED` y programa reintento.

## Estados

- `WAITING_RECEIPT`: todavía no existe comprobante definitivo para enviar.
- `PENDING`: listo para entrega.
- `PROCESSING`: tomado por un worker.
- `SENT`: confirmado por el proveedor del canal.
- `FAILED`: falló y puede reintentarse.
- `CANCELLED`: cancelado administrativamente.

## Seguridad

- La entrega usa el enlace público firmado del comprobante; no expone tokens PSE/SUNAT.
- En producción no se marca como enviado si no existe un adaptador real del canal.
- `DELIVERY_PROVIDER=disabled` es el valor seguro por defecto.
- `DELIVERY_PROVIDER=mock` solo sirve para pruebas internas.

## Idempotencia

La cola usa `tenant_id + idempotency_key` para evitar duplicar la misma entrega ante reintentos del teléfono.

## Endpoints

### POST `/v1/receipts/by-transaction/:clientTransactionId/deliveries`

Body:

```json
{
  "channel": "WHATSAPP",
  "destination": "+51999999999"
}
```

### GET `/v1/deliveries?limit=100`

Lista las entregas del tenant autenticado.

### POST `/v1/deliveries/process-pending`

Dispara el procesamiento en desarrollo. En producción debe ser reemplazado por un worker/cron interno y no depender del celular.

## Próximo adaptador

Para WhatsApp automático se requiere WhatsApp Business Platform/Cloud API o un BSP autorizado. Abrir `wa.me` desde el teléfono sigue siendo entrega asistida, no envío servidor-a-servidor.
