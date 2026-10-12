# Contrato de estado en la API y E2E

El backend expone dos campos diferentes para evitar mezclar estado técnico de API con estado SUNAT/local:

- `status`: `ACCEPTED | REJECTED | PENDING | ERROR`
- `sunatStatus`: `ACEPTADO | RECHAZADO | PENDIENTE | ENVIANDO | ERROR`

La versión 0.12.1 fallaba en el primer comprobante porque la prueba esperaba `status = ACEPTADO`, aunque el endpoint respondía correctamente `status = ACCEPTED` y `sunatStatus = ACEPTADO`.

La versión 0.12.2 corrige la prueba y verifica ambos valores.
