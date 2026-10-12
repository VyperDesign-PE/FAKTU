# Checklist del gran hito - primera emision beta

## A. Preparacion

- [ ] PostgreSQL levantado y migraciones 0.12.0 aplicadas.
- [ ] Negocio de prueba con RUC y razon social cargados.
- [ ] Ubigeo/direccion tributaria revisados.
- [ ] Empresa creada en APIsPERU con ambiente `beta`.
- [ ] Token de empresa disponible solo en backend.
- [ ] `provider_code = apisperu` y `environment = sandbox` en el tenant.
- [ ] Prueba `test:apisperu-adapter` aprobada.
- [ ] `test:apisperu-sandbox` muestra conectividad OK sin emitir.

## B. Primera boleta beta

- [ ] Activar `APISPERU_SANDBOX_CONFIRM=YES`.
- [ ] Emitir boleta de prueba por S/ 1.18.
- [ ] Obtener respuesta SUNAT/CDR.
- [ ] Confirmar estado `ACEPTADO`.
- [ ] Confirmar serie/correlativo.
- [ ] Confirmar XML/hash/CDR guardados.
- [ ] Generar PDF propio.
- [ ] Crear enlace seguro.

## C. Resiliencia

- [ ] Simular respuesta perdida despues del POST.
- [ ] Estado interno queda `PENDIENTE`, no `RECHAZADO`.
- [ ] Reintento del celular NO vuelve a emitir.
- [ ] `/reconcile` consulta `invoice/status`.
- [ ] Si SUNAT ya acepto, cambia a `ACEPTADO`.
- [ ] Cola de entrega se libera una sola vez.

## D. Segunda empresa

- [ ] Registrar tenant B.
- [ ] Credencial diferente a tenant A.
- [ ] Series independientes.
- [ ] Ningun comprobante/cliente/credencial se cruza entre tenants.
