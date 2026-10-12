# Consulta RUC oficial sin costo por consulta — MVP 0.10.0

## Decisión de arquitectura

Para RUC no dependemos de una API comercial por cada búsqueda. El backend sincroniza el **Padrón Reducido del RUC** publicado por SUNAT y lo indexa en PostgreSQL.

Fuente oficial:

- Página: https://www.sunat.gob.pe/descargaPRR/mrc137_padron_reducido.html
- ZIP: https://www2.sunat.gob.pe/padron_reducido_ruc.zip

SUNAT indica que el padrón reducido contiene RUC, nombre o razón social, estado del contribuyente, condición de domicilio, ubigeo y domicilio fiscal. Es una fotografía de los datos a la fecha de actualización, no una consulta transaccional en vivo.

## Flujo de consulta

```text
RUC ingresado
   |
   v
sunat_ruc_registry (índice oficial local)
   |-- encontrado --> datos SUNAT, costo API S/ 0
   |
   +-- no encontrado --> customer cache del tenant
                         |
                         +-- no existe --> proveedor externo opcional de respaldo
```

Para DNI se mantiene la estrategia distinta:

```text
cache del celular -> customers del tenant -> API DNI solo si es nuevo
```

## Tablas

### `sunat_ruc_registry`

Índice global compartido por todos los tenants. La clave primaria es `ruc`, por lo que la búsqueda exacta no necesita un índice adicional.

Campos principales:

- `ruc`
- `legal_name`
- `taxpayer_status`
- `domicile_condition`
- `ubigeo`
- `fiscal_address`
- `data_version`
- `source_updated_at`
- `imported_at`

### `sunat_ruc_import_runs`

Audita cada actualización:

- URL de origen
- fecha informada por la fuente
- SHA-256 del archivo descargado
- filas procesadas
- estado RUNNING / COMPLETED / FAILED
- error de importación, si ocurrió

## Importador

El job es:

```bash
npm run sync:sunat-ruc
```

Por defecto descarga el ZIP oficial de SUNAT, calcula SHA-256, extrae `padron_reducido_ruc.txt`, decodifica latin-1 y procesa por streaming. No carga el archivo completo en memoria.

También puede probarse con un archivo local:

```bash
npm --workspace @app/api run sync:sunat-ruc -- \
  --file src/fixtures/sunat_padron_sample.txt \
  --source-date 2026-08-28 \
  --min-rows 2 \
  --no-prune
```

La opción `--no-prune` es obligatoria para fixtures pequeños. En la carga oficial puede depurarse del índice cualquier RUC que ya no aparezca, pero únicamente después de que el archivo completo supere el mínimo de seguridad.

## Protecciones

1. **Esquema estricto.** Si SUNAT cambia inesperadamente el número de columnas, la importación aborta.
2. **Mínimo de filas.** `SUNAT_RUC_MIN_ROWS` evita que un archivo truncado borre el padrón anterior.
3. **No se borra antes de validar.** Las filas antiguas solo se depuran al finalizar una importación completa.
4. **Último padrón válido.** Si la actualización falla, las consultas pueden seguir usando los datos que ya estaban cargados.
5. **Sin scraping del formulario web.** Se utiliza el archivo público de descarga de SUNAT.
6. **Fuente visible.** La UI indica que el dato proviene del Padrón Reducido SUNAT y muestra su fecha cuando está disponible.

## Variables de entorno

```env
SUNAT_RUC_PADRON_URL=https://www2.sunat.gob.pe/padron_reducido_ruc.zip
SUNAT_RUC_BATCH_SIZE=5000
SUNAT_RUC_MIN_ROWS=5000000
SUNAT_RUC_PRUNE_MISSING=true
DOCUMENT_LOOKUP_RUC_COST_PEN=0
```

## Frecuencia recomendada

Ejecutar la sincronización **una vez al día**, fuera de horas de mayor tráfico. La consulta del POS no descarga nada de SUNAT: siempre responde desde el índice local ya preparado.

## Limitación importante

El padrón es una fotografía. Un RUC recién creado o modificado puede no aparecer hasta la siguiente publicación/sincronización. Por ello el sistema conserva un proveedor externo opcional de respaldo y, si ambos fallan, permite ingreso manual sin bloquear la venta.
