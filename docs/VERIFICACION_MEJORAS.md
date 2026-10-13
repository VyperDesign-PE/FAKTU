# Verificación de las mejoras

Fecha: 12–13 oct 2026. Entorno: Windows 11, Node 24.13, Chrome sin interfaz (Windows). Sin PostgreSQL ni Docker en ejecución. Datos siempre sintéticos.

## Pruebas ejecutadas
| Comprobación | Resultado |
|---|---|
| `npm run typecheck` (API y móvil) | Pasa, antes y después |
| `npm test` completo, incluido `test:mobile` | Pasa: unit 17, apisperu 23, nubefact 20, adaptador apisperu, parser RUC, **móvil 7 + navegación + paleta (44 contrastes)** |
| `npm run build:web` | Pasa, antes y después |
| Regresión hallazgo 1 | `tests/navigation.ts` **falla** con el router original (Customers, CustomerForm, BillingSettings) y pasa con el corregido |
| IGV cliente = servidor | 500 casos aleatorios idénticos al centavo |
| Contraste AA | 44 pares en claro y oscuro; los fallos de la paleta anterior (éxito 3,36; advertencia 3,96) están corregidos |
| Tamaño táctil | Medido en el navegador a 390 px en Inicio e Historial: ningún control < 44 px tras el cambio (antes: 38 y 41 px) |
| Foco por teclado (web, 1280 px) | Tab recorre el menú lateral con anillo visible (`foco-light-1280.png`) |

**No ejecutadas:** `test:integration`, E2E (`e2e:up`, `run-e2e-local.sh`) y cualquier prueba contra PostgreSQL, porque Docker Desktop no estaba activo. No se verificó nada de worker, multitenancy, migraciones ni sesiones. Tampoco Android/iOS, Safari/Firefox ni lector de pantalla.

## Capturas (`docs/capturas/`)
Generadas con un servidor simulado fuera del proyecto (no es la API real) y datos inventados. Solo existen capturas "después": no se capturaron las pantallas originales, así que **no hay comparación antes/después de pantallas**. Hay acceso a 390 px (oscuro y claro), panel a 390/320/1280, venta a 390/1280, historial a 390, foco a 1280 e icono de 512 px antes y después.

## Matriz de cobertura (revisión heurística del agente; NO es una prueba con personas)
| Tarea | Entorno | Datos | Esperado | Observado | Estado |
|---|---|---|---|---|---|
| Entrar con la demo | Web 390 claro/oscuro | demo simulada | llegar al panel | llegó | OK |
| Ver ventas del día y alertas | Web 320/390/1280 | bodega simulada | cifras legibles sin desbordar | sin desbordes visibles | OK (revisión visual) |
| Elegir producto en Vender | Web 390 y 1280 | catálogo mezclado de bodega, librería y menú | buscar y tocar tarjetas | tarjetas ≥ 44 px | OK; **no se probó** agregar al carrito, cobrar ni el timeout |
| Navegar solo con teclado | Web 1280 | — | foco visible | visible en el menú | Parcial (solo menú lateral) |
| Venta mock completa, doble pulsación, offline y reinicio, sincronización sin duplicados | — | — | — | — | **No ejecutado** (requiere API real) |
| Texto ampliado, lector de pantalla, teclado abierto en pantalla pequeña | — | — | — | — | **No ejecutado** |
| Rubros bodega, librería y restaurante | catálogo sintético mezclado | — | núcleo común | solo se vio el catálogo | Parcial; mesas y cocina quedan fuera de alcance |

Barreras conocidas: no se evaluó daltonismo con simulador (se usó texto, icono y contraste medido); el interruptor de tema muestra "Modo claro" como etiqueta de acción y puede confundir; Onboarding, Clientes, Productos y Por cobrar no se recorrieron visualmente tras el cambio.

## Skills y subagentes
Skills invocadas con la herramienta Skill: **ninguna**. `frontend-design` no estaba entre las disponibles. Se usaron tres subagentes de exploración (solo lectura) para el reporte inicial; el resto lo hizo la sesión principal.

## Riesgos pendientes
Las cifras del panel principal (servidor) no se revisaron. El resto está en la trazabilidad de `docs/MEJORAS_UX_UI.md`.
