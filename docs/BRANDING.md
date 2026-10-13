# Marca FAKTU — guía de lo implementado

Estado: ruta **C "FAKTU Ágil"** aplicada en el cliente real (`apps/mobile`). Lo marcado como *propuesta* no está implementado.

## Posicionamiento (propuesta, sin validar con usuarios)
FAKTU ayuda a bodegas, librerías y restaurantes de menú a vender y emitir boletas y facturas desde el celular o la computadora. Promesas verificables hoy: venta rápida, historial, fiados, cierre de caja, modo práctica. **No se promete** "aprobado por SUNAT", "sin errores" ni "todo funciona sin internet": la emisión real contra SUNAT nunca se probó (ver `docs/PILOTO.md`).
Lema a evaluar (no usado en pantallas): "Menos pasos. Más claridad".

## Comparación de las tres rutas
Contrastes medidos (WCAG) con los colores propuestos; estados: éxito `#169B52`, error `#B42318`, advertencia `#B26A00`.

| | A Claro | B Cercano | C Ágil (elegida) |
|---|---|---|---|
| Primario | `#1B7F79` | `#B64F3D` | `#2547A8` |
| Texto blanco sobre primario | 4,82 | 5,03 | **8,25** |
| Distancia con un estado | turquesa ≈ éxito verde (1,34): se confunden | terracota ≈ error rojo (1,31): se confunden | ninguna |
| Riesgo | contraste justo; choca con "aceptado" | un acento de marca parece una falla | densidad tipo tablero (mitigada: pocas cifras) |

Elección: **C**. Mayor contraste, el color de marca no compite con ningún significado de estado, y conserva la "F" y el punto menta de la identidad anterior. A y B no se probaron en pantalla (solo se midió el contraste); es una comparación por medición, no por exploración visual.

## Isotipo y logotipo
- Cuadrado redondeado cobalto con una "F" blanca y un **punto final menta** ("F."): la F cierra con un punto, como un comprobante cerrado.
- Antes el icono instalable era "F." con el punto al pie, pero el isotipo dentro de la app lo ponía en la esquina (parecía una notificación). Ahora es el mismo dibujo en ambos.
- Geometría única: `apps/mobile/src/brand/mark.ts`. La usan `<BrandMark />` / `<BrandLogo />` (`components/Brand.tsx`) y `scripts/generate-icons.ts`.
- Palabra: **FAKTU** en mayúsculas, peso 900, `letterSpacing` 1,5. En textos corridos también FAKTU (no "Faktu").
- Variantes: isotipo solo (iconos, cabecera móvil) y horizontal (isotipo + palabra). **No hay** variante monocromática ni exportación SVG: pendiente.
- Iconos generados (sin herramientas externas): `npm --workspace @app/mobile run icons` → `assets/icon.png`, `public/icon-512.png`, `icon-192.png`, `favicon.png`, `icon-maskable-512.png` (dibujo al 80 % para la zona segura). Comparación: `docs/capturas/icono-512-anterior.png` vs `icono-512.png`.

## Paleta por roles
Fuente única: `apps/mobile/src/brand/palette.ts`. `theme.ts` la usa en nativo; `npm --workspace @app/mobile run sync:palette` la vuelca en `public/index.html` (web). `tests/palette.ts` falla si el HTML no coincide o si un par pierde contraste AA.

| Rol | Claro | Oscuro | Nota |
|---|---|---|---|
| Fondo / superficie | `#F5F7FC` / `#FFFFFF` | `#0A1127` / `#121B38` | |
| Texto / secundario | `#16203F` / `#55607F` | `#EDF0FB` / `#A3ACCF` | secundario ≥ 4,5 |
| Primario (relleno de botón, texto blanco encima) | `#2547A8` | `#4568E0` | |
| `primaryText` (enlaces y texto de marca) | `#2547A8` | `#8FA8FF` | token nuevo: en oscuro el mismo color no sirve de fondo y de texto |
| Fondo oscuro de marca (`ink`) y su texto | `#101A3D`; `onInkMuted` `#C5CEF0` | `#0D1531` | menú, tarjeta destacada |
| Acento menta | `#19C58B` | igual | **decorativo**: nunca significa un estado |
| Éxito / advertencia / error | `#0F7A3E` / `#8A5300` / `#B42318` | `#4CD98F` / `#F5B544` / `#FF8A80` | siempre con texto o icono |

Cambio de contraste confirmado: en la paleta anterior el texto de éxito (3,36) y de advertencia (3,96) sobre el fondo no llegaba a AA 4,5; ahora sí.

## Tipografía y espaciado
Se mantiene la fuente del sistema (sin fuentes remotas). Pesos: 900 para títulos e importes, 800 para etiquetas. Importes con prefijo `S/`. **Pendiente**: escala tipográfica formal y cifras tabulares (no se midió el soporte en las fuentes de sistema de cada plataforma).
Controles táctiles ≥ 44 px (botones de cabecera, chips, atajos).

## Tono
Español directo, verbos concretos. Etiquetas de estado en un solo lugar: `src/domain/receiptStatus.ts` (p. ej. local "Guardado, falta enviar", "Error al enviar"; remoto "En proceso", "Requiere revisión"). ERROR nunca se muestra como "Rechazado".

## Identidad del negocio emisor
No se tocaron comprobantes, PDF, enlaces públicos ni datos fiscales del negocio. FAKTU es la marca de la plataforma; razón social, RUC, numeración y QR siguen siendo los del emisor.

## Pendiente
Variante monocromática y SVG; pantalla de arranque nativa (`app.json` no define `splash`); guía de iconografía (hoy se usan símbolos de texto); revisión de onboarding, clientes, productos y por cobrar con los tokens nuevos (heredan colores, pero no se revisaron una por una); validar la identidad con personas usuarias.
