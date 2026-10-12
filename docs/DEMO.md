# FAKTU — Dónde correrlo y cómo preparar una demo

FAKTU es una app web (PWA) servida por la misma API. Con **un solo servicio** (API + web) y PostgreSQL ya puedes mostrarla en cualquier navegador, en PC o celular. Todo queda en **modo práctica**: el simulador emite los comprobantes, sin validez ante SUNAT ni costo.

## 1. Dónde correrlo

| Opción | Para qué | Requisitos |
|---|---|---|
| **A. Docker en tu laptop** (recomendada) | Demo presencial en tu PC; se levanta con 2 comandos | Docker Desktop |
| **B. Sin Docker** | Desarrollo y ajustes de última hora | Node 22 y PostgreSQL 16 |
| **C. En la nube con HTTPS** | Mostrarla a clientes desde su celular y poder "instalarla" (PWA exige HTTPS) | Una cuenta en Render, Railway o Fly.io y una base PostgreSQL |
| **D. Expo Go en el celular** | Ver la versión nativa durante el desarrollo | Celular y PC en la misma red |

### A. Docker (2 comandos)

```bash
npm run demo:up      # construye y levanta PostgreSQL + FAKTU en http://localhost:4000
npm run demo:seed    # carga "Bodega Don Pepe": 7 días de ventas, stock bajo, fiados, una anulación
```

Abre http://localhost:4000 e ingresa con:

- Usuario: `demo@faktu.pe`
- Contraseña: `Demo-Faktu-2026`

Para reiniciar la demo desde cero: `npm run demo:down && npm run demo:up && npm run demo:seed`.

### B. Sin Docker

```bash
npm ci
createdb faktu_demo                      # PostgreSQL 16 local
npm run build:web                        # genera la app web en apps/mobile/dist-web
cd apps/api
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/faktu_demo
export DB_AUTO_MIGRATE=true JWT_SECRET=demo-secret BILLING_PROVIDER=mock DELIVERY_PROVIDER=mock
export PUBLIC_APP_BASE_URL=http://localhost:4000 PUBLIC_RECEIPT_LINK_SECRET=demo-link-secret
export WEB_DIST_DIR=../mobile/dist-web NODE_ENV=development
npm run dev                              # API + web en http://localhost:4000
# en otra terminal, con el mismo DATABASE_URL:
npm run demo:seed
```

### C. En línea con HTTPS (Render, ~10 minutos)

El repositorio trae `render.yaml` (Blueprint): crea el servicio web, la base PostgreSQL y las claves secretas, y **carga la demo sola** en el primer arranque (`DEMO_AUTOSEED=true`).

1. Entra a https://render.com y crea una cuenta con GitHub.
2. **New → Blueprint** → conecta el repositorio `VyperDesign-PE/FAKTU` y elige la rama `faktu-0.13-estabilizacion` (o `main` una vez fusionada).
3. Render lee `render.yaml`; confirma con **Apply**. La primera construcción tarda unos 5–8 minutos.
4. Abre la URL `https://faktu-xxxx.onrender.com` e ingresa con `demo@faktu.pe` / `Demo-Faktu-2026`.
5. En el celular abre el mismo enlace y usa "Agregar a pantalla de inicio" para instalarla como app.
6. Dominio propio (opcional): Settings → Custom Domains → `app.tudominio.pe`.

Notas del plan gratuito de Render: el servicio se duerme tras ~15 min sin visitas (el primer acceso tarda 30–60 s: ábrelo antes de presentar) y la base gratuita caduca a los 30 días. Para un piloto con clientes reales usa el plan de pago (~US$ 7 web + ~US$ 6 base) y desactiva la carga automática de la demo quitando `DEMO_AUTOSEED`.

Otras plataformas (Railway, Fly.io, un VPS): usa `infra/Dockerfile`, puerto 4000, health check `/health` y las mismas variables que `render.yaml`; define `PUBLIC_APP_BASE_URL=https://tu-dominio`.

> Para el piloto real (facturación con SUNAT) sigue `docs/PILOTO.md`: ahí se configura APIsPERU y se desactiva el modo práctica por negocio.

### D. Expo Go (solo desarrollo)

```bash
EXPO_PUBLIC_API_URL=http://IP-DE-TU-PC:4000 npm run dev:mobile
```

Escanea el QR con Expo Go. En el celular la app sigue el modo claro/oscuro del sistema; el botón manual de tema existe solo en la versión web.

## 2. Guion sugerido (8–10 minutos)

Prepara antes: demo cargada, navegador en pantalla completa, y una pestaña extra con la versión celular (F12 → modo dispositivo, o tu teléfono).

1. **Mi negocio (30 s).** "Así ve el dueño su día": ventas de hoy vs ayer, gráfico de 7 días, lo que más vende, stock bajo, por cobrar.
2. **Vender en un paso (2 min).** Ir a *Vender*, tocar 3 productos, elegir **Yape**, "COBRAR". Mostrar que no hay 7 pantallas. Luego compartir por WhatsApp.
3. **Fiado (2 min).** Nueva venta → **Fiado** → DNI y celular → cobrar. Ir a *Por cobrar*: la deuda más antigua, **Registrar pago** parcial y **Recordar por WhatsApp**.
4. **Stock (1 min).** En *Productos y stock* ver "Quedan 4" en Inca Kola; la venta anterior ya descontó.
5. **Anular (1 min).** En *Comprobantes* abrir una boleta → Nota de crédito (devolución parcial) y ver que repone stock.
6. **Cierre de caja (1 min).** Efectivo esperado, cobros de fiados incluidos, y descarga para el contador.
7. **Modo oscuro y celular (30 s).** Alternar "Modo oscuro" y mostrar la barra inferior en el celular.
8. **Sin Internet (30 s, opcional).** Apagar el Wi-Fi: seguir vendiendo; al volver se sincroniza.

Frases a evitar: no digas que los comprobantes son reales. Aclara que la demo usa el simulador y que con APIsPERU/Nubefact cada negocio emite con validez SUNAT.

## 3. Lista de verificación antes de presentar

- [ ] `npm run demo:seed` mostró "Demo lista".
- [ ] Ingresé con `demo@faktu.pe` y el dashboard tiene números.
- [ ] Probé una venta y un fiado nuevos (el cobro no da error).
- [ ] Revisé el tema oscuro y la vista celular.
- [ ] Tengo a mano el enlace (nube) o `http://localhost:4000` (Docker).
- [ ] Hay Internet de respaldo; sin él la demo igual funciona en localhost.
