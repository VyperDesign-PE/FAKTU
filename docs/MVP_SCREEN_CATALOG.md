# MVP 1.0 — Catálogo de pantallas SaaS de facturación electrónica Perú

Objetivo del MVP: que un pequeño negocio pueda registrarse, configurar su empresa, vender, emitir boletas/facturas, operar temporalmente sin Internet, entregar el comprobante y consultar su historial con una experiencia simple. El producto es multi-tenant: toda operación pertenece a un `tenant` (empresa/negocio) y nunca debe mezclarse con datos de otro negocio.

## 1. Autenticación y onboarding

### A01 — Ingresar
**Inputs**
- Correo electrónico.
- Contraseña.

**Acciones críticas**
- Validar formato del correo y contraseña mínima.
- Ingresar.
- Ir a registro.
- Recuperar contraseña.
- Si el usuario pertenece a un solo tenant, continuar al Dashboard; si pertenece a más de uno, pasar por A04.

### A02 — Crear cuenta
**Inputs**
- Correo.
- Contraseña.
- Confirmación de contraseña.
- Aceptación de términos y política de privacidad.

**Acciones críticas**
- Validar coincidencia y fortaleza básica.
- Crear usuario.
- Crear tenant inicial en estado de configuración.
- Iniciar sesión automáticamente.

### A03 — Recuperar contraseña
**Inputs**
- Correo.
- Código de recuperación.
- Nueva contraseña y confirmación.

**Acciones críticas**
- Solicitar código/enlace.
- Validar código.
- Cambiar contraseña.
- Invalidar sesiones anteriores si el usuario lo solicita.

### A04 — Seleccionar negocio
Solo se muestra cuando una cuenta tiene acceso a más de un tenant.

**Inputs**
- Buscador de negocios (opcional).

**Acciones críticas**
- Mostrar nombre comercial, RUC y rol del usuario.
- Seleccionar tenant activo.
- Impedir acceso cruzado a otro tenant sin membresía.

### A05 — Verificar celular
**Inputs**
- Número de celular.
- Código OTP de 6 dígitos.

**Acciones críticas**
- Enviar / reenviar OTP.
- Verificar número.
- Limitar reintentos.

### A06 — Buscar RUC y confirmar empresa
**Inputs**
- RUC de 11 dígitos.

**Acciones críticas**
- Validar RUC.
- Consultar datos del contribuyente.
- Mostrar razón social, nombre comercial, estado y dirección.
- Confirmar "Este es mi negocio".
- Permitir corregir RUC.

### A07 — Conectar facturación electrónica
**Inputs**
- Proveedor de facturación seleccionado (normalmente oculto al usuario si existe uno por defecto).
- Datos de autorización requeridos por el proveedor.

**Acciones críticas**
- Iniciar autorización segura con PSE/API externa.
- No persistir Clave SOL en texto plano.
- Mostrar comprobantes habilitados.
- Informar si la conexión está activa, pendiente o requiere revisión.

### A08 — Configuración completada
**Inputs**
- Ninguno.

**Acciones críticas**
- Mostrar empresa, RUC y tipos de comprobantes disponibles.
- CTA "Hacer mi primera venta".
- Ir al Dashboard.

---

## 2. Dashboard / métricas

### D01 — Dashboard principal
**Inputs**
- Filtro temporal simple: Hoy / 7 días / Mes (el MVP puede iniciar solo con Hoy).

**Acciones críticas**
- CTA principal "Nueva venta".
- Mostrar total vendido, cantidad de boletas/facturas, ticket promedio y pendientes.
- Mostrar estado del sistema sin lenguaje técnico.
- Acceso a comprobantes observados.
- Aviso de suscripción próxima a vencer.

### D02 — Estado del sistema
**Inputs**
- Ninguno.

**Acciones críticas**
- Mostrar: Todo funciona / Sin Internet / Pendientes / Servicio de facturación con inconvenientes / Mantenimiento.
- Reintentar sincronización.
- Abrir soporte.
- Nunca mostrar errores de infraestructura sin traducirlos a lenguaje simple.

### D03 — Alertas y tareas pendientes
**Inputs**
- Filtro por tipo: comprobantes, suscripción, configuración.

**Acciones críticas**
- Abrir directamente el elemento que requiere atención.
- Marcar alerta como revisada.

---

## 3. POS / Venta

### P01 — POS Venta
**Inputs**
- Búsqueda de producto/servicio.
- Cantidad.
- Precio editable solo si el rol lo permite.
- Descuento opcional.

**Acciones críticas**
- Añadir favoritos con un toque.
- Crear venta manual.
- Abrir catálogo.
- Modificar cantidades y eliminar líneas.
- Mostrar subtotal, impuestos y total.
- Continuar aunque no haya Internet, guardando localmente.

### P02 — Selector de productos / catálogo rápido
**Inputs**
- Búsqueda.
- Categoría.
- Favoritos.

**Acciones críticas**
- Añadir uno o varios productos al carrito.
- Crear producto/servicio nuevo sin abandonar la venta.

### P03 — Crear producto / servicio
**Inputs**
- Nombre.
- Precio de venta.
- Unidad.
- Categoría opcional.
- Favorito sí/no.

**Acciones críticas**
- Validar nombre y precio.
- Guardar en catálogo del tenant.
- Añadir inmediatamente a la venta actual.

### P04 — Venta rápida / manual
**Inputs**
- Concepto.
- Importe.
- Cantidad opcional.

**Acciones críticas**
- Añadir a la venta sin crear producto permanente.

### P05 — Cliente de la venta
**Inputs**
- Sin datos / DNI / RUC.
- Número de documento.
- Nombre o razón social si la consulta no está disponible.
- Dirección cuando corresponda.
- Teléfono / WhatsApp opcional.

**Acciones críticas**
- Consultar DNI/RUC.
- Validar reglas mínimas del tipo de comprobante.
- Guardar cliente para futuras ventas si el usuario lo desea.

### P06 — Tipo de comprobante
**Inputs**
- Boleta.
- Factura.

**Acciones críticas**
- Mostrar solo los documentos habilitados para el tenant.
- Exigir RUC para factura.
- Aplicar reglas configurables sin exponer complejidad tributaria.

### P07 — Resumen y confirmación
**Inputs**
- Observación opcional.
- Canal de entrega preferido: WhatsApp / enlace / PDF / correo si se habilita.

**Acciones críticas**
- Revisar cliente, líneas, impuestos y total.
- Confirmar emisión una sola vez.
- Generar `clientTransactionId` idempotente.
- Bloquear doble toque de emisión.

### P08 — Resultado de emisión
**Inputs**
- Ninguno.

**Acciones críticas**
- Mostrar Aceptado / Pendiente / Requiere revisión.
- Mostrar serie y correlativo oficial cuando exista.
- Compartir.
- Nueva venta.
- Ver comprobante.

### P09 — Constancia temporal offline
**Inputs**
- Teléfono/WhatsApp del cliente opcional.

**Acciones críticas**
- Mostrar número temporal `VT-XXXXXX`.
- Compartir constancia temporal.
- Explicar que no es el comprobante electrónico definitivo.
- Guardar venta en cola persistente.

### P10 — Sincronización de pendientes
**Inputs**
- Ninguno.

**Acciones críticas**
- Enviar automáticamente al recuperar Internet.
- Reintentar con backoff.
- Evitar duplicados por idempotencia.
- Mostrar progreso y errores que necesitan acción humana.

---

## 4. Gestión de comprobantes

### C01 — Historial de comprobantes
**Inputs**
- Fecha desde/hasta.
- Tipo: boleta/factura.
- Estado.
- DNI/RUC/cliente.
- Serie/correlativo.

**Acciones críticas**
- Buscar y filtrar.
- Abrir detalle.
- Diferenciar Aceptado / Pendiente / Observado de forma visual.

### C02 — Detalle de comprobante
**Inputs**
- Ninguno, salvo observaciones de soporte.

**Acciones críticas**
- Mostrar datos completos de la venta.
- Descargar/abrir PDF.
- Compartir enlace.
- Reenviar al cliente.
- Mostrar XML/CDR solo en un apartado avanzado, no en la vista principal.

### C03 — Reenviar / compartir comprobante
**Inputs**
- WhatsApp/teléfono.
- Correo opcional.

**Acciones críticas**
- Generar enlace seguro con expiración configurable.
- Enviar PDF o enlace.
- Registrar evento de entrega para auditoría.

### C04 — Corregir / anular mediante nota de crédito
**Inputs**
- Comprobante origen.
- Motivo permitido.
- Descripción.
- Importe/ítems afectados cuando corresponda.

**Acciones críticas**
- Validar que el proveedor soporte nota de crédito.
- Solicitar confirmación explícita.
- Emitir documento relacionado y conservar trazabilidad.

### C05 — Comprobante observado / error
**Inputs**
- Solo campos corregibles requeridos por el error.

**Acciones críticas**
- Traducir error técnico a una instrucción concreta.
- Corregir y reintentar cuando sea legal/técnicamente válido.
- Contactar soporte con contexto del tenant y `clientTransactionId`.

---

## 5. Clientes

### CL01 — Lista de clientes
**Inputs**
- Buscador por nombre, DNI o RUC.

**Acciones críticas**
- Crear cliente.
- Abrir ficha.
- Seleccionar cliente desde una venta.

### CL02 — Crear / editar cliente
**Inputs**
- Tipo de documento.
- DNI/RUC.
- Nombre/razón social.
- Dirección.
- Teléfono/WhatsApp.
- Correo opcional.

**Acciones críticas**
- Consultar datos cuando exista servicio disponible.
- Validar documento.
- Guardar solo dentro del tenant activo.

### CL03 — Ficha del cliente
**Inputs**
- Ninguno.

**Acciones críticas**
- Ver datos.
- Editar.
- Ver últimos comprobantes.
- Iniciar nueva venta con el cliente preseleccionado.

---

## 6. Configuración de empresa

### E01 — Datos de empresa
**Inputs**
- RUC (solo editable mediante flujo controlado).
- Razón social.
- Nombre comercial.
- Dirección fiscal.
- Logo opcional.
- Teléfono y correo comercial.

**Acciones críticas**
- Guardar cambios.
- Revalidar datos críticos con el servicio tributario cuando corresponda.

### E02 — Facturación electrónica / proveedor
**Inputs**
- Proveedor asignado.
- Ambiente: sandbox/producción (solo administrador).
- Datos de autorización requeridos.

**Acciones críticas**
- Conectar/reautorizar proveedor.
- Probar conexión.
- Mostrar tipos de documentos habilitados.
- No mostrar ni guardar secretos en texto plano.

### E03 — Series y comprobantes
**Inputs**
- Serie de boleta.
- Serie de factura.
- Series para notas, si aplica.

**Acciones críticas**
- Validar formato.
- Evitar colisiones de serie/correlativo.
- Mostrar qué series administra el proveedor externo y cuáles administra la app.

### E04 — Usuarios y roles
**Inputs**
- Correo del usuario.
- Rol: Propietario / Administrador / Cajero.

**Acciones críticas**
- Invitar usuario.
- Cambiar rol.
- Desactivar acceso.
- Impedir que un cajero vea configuración sensible.

### E05 — Suscripción SaaS
**Inputs**
- Plan.
- Medio de pago cuando se implemente cobro automático.
- Datos de facturación de la suscripción.

**Acciones críticas**
- Mostrar precio mensual, estado, fecha de renovación y límites.
- Cambiar plan.
- Actualizar medio de pago.
- Descargar comprobantes de la suscripción.
- Mostrar gracia/restricciones antes de suspender emisión.

### E06 — Cuenta y seguridad
**Inputs**
- Correo.
- Contraseña actual/nueva.

**Acciones críticas**
- Cambiar contraseña.
- Cerrar otras sesiones.
- Cerrar sesión.
- Solicitar eliminación/cierre de cuenta mediante flujo controlado.

### E07 — Soporte y diagnóstico
**Inputs**
- Motivo.
- Descripción opcional.

**Acciones críticas**
- Mostrar estado de Internet, API y sincronización con lenguaje simple.
- Crear ticket con identificadores técnicos adjuntos internamente.
- Nunca pedir la Clave SOL por chat o formulario.

---

## 7. Backoffice SaaS interno (mínimo para operar el servicio)

### BO01 — Tenants / negocios
- Buscar por RUC, correo o nombre.
- Ver estado, plan, proveedor y última actividad.
- Entrar a soporte con trazabilidad; nunca suplantar silenciosamente al usuario.

### BO02 — Suscripciones
- Estado de trial/pago/gracia/suspensión.
- Cambio administrativo de plan con auditoría.

### BO03 — Monitor de facturación
- Comprobantes por proveedor.
- Errores y latencia.
- Reintentos seguros.
- Cola de pendientes por tenant.

### BO04 — Auditoría y soporte
- Eventos de login, cambios de configuración, emisiones y reintentos.
- Búsqueda por `clientTransactionId` sin exponer secretos.

---

## Fuera del MVP 1.0

Para mantener costo y complejidad bajo control, quedan fuera inicialmente: inventario/kardex completo, compras, contabilidad, planillas, múltiples almacenes, CRM avanzado, cuentas por cobrar y reportes financieros complejos.
