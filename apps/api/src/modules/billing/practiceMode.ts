/**
 * Modo práctica: mientras la facturación electrónica de un negocio no está
 * activa (proveedor "mock"), las ventas usan series propias que empiezan con
 * "T". Así la práctica:
 * - no consume los correlativos reales (Nubefact exige numerar desde 1, sin saltos),
 * - nunca se envía a un proveedor real, aunque el negocio se active después,
 * - no aparece en el registro de ventas para el contador.
 */
export const PRACTICE_SERIES = {
  BOLETA: "TB01",
  FACTURA: "TF01",
  NOTA_CREDITO: "TC01"
} as const;

export function isPracticeSeries(series: string) {
  return series.toUpperCase().startsWith("T");
}
