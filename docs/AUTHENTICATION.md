# Autenticación — iteración 0.3.0

## Flujo móvil

```text
Login
  ├─ INGRESAR -> Home (usuario configurado)
  └─ REGISTRARME -> Register -> VerifyPhone -> onboarding del negocio
```

La pantalla `Login` incluye:

- correo electrónico;
- contraseña;
- validación local básica;
- estado de carga para evitar doble envío;
- botón `INGRESAR`;
- botón `REGISTRARME`;
- almacenamiento del token en `expo-secure-store`.

La pantalla `Register` incluye correo, contraseña, confirmación y validación de coincidencia.

## Seguridad

- Las contraseñas no se guardan en el móvil.
- El backend almacena un hash `scrypt` con salt aleatorio.
- El token JWT se guarda con SecureStore, no con AsyncStorage.
- En producción `JWT_SECRET` es obligatorio.
- RUC/DNI/PSE/comprobantes requieren sesión autenticada en la API.
- Los datos locales del negocio, catálogo y cola offline están separados por `user.id` para evitar cruces entre cuentas en el mismo teléfono.

## Persistencia

La tabla `app_users` se crea en PostgreSQL al iniciar la API si aún no existe.

Campos principales:

- `id` UUID;
- `email` único;
- `password_hash`;
- `created_at`;
- `updated_at`.

## Próximas mejoras de autenticación

- refresh tokens rotatorios;
- recuperación de contraseña;
- verificación real de correo;
- bloqueo/rate limit por intentos fallidos;
- MFA opcional para administración;
- sesiones visibles y revocables por dispositivo.
