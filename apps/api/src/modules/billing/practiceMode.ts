/**
 * Modo práctica: mientras la facturación electrónica de un negocio no está
 * activa (proveedor "mock"), sus documentos se marcan como práctica
 * (`is_practice`) y usan series propias. Así la práctica:
 * - no consume los correlativos reales (se exige numerar desde 1, sin saltos),
 * - nunca se envía a un proveedor real, aunque el negocio se active después,
 * - no aparece en el registro de ventas para el contador.
 *
 * La marca es explícita: no se deduce de la serie, porque las guías de
 * remisión reales también empiezan con "T".
 */
export const PRACTICE_SERIES = {
  BOLETA: "TB01",
  FACTURA: "TF01",
  NOTA_CREDITO: "TC01",
  NOTA_DEBITO: "TD01",
  GUIA_REMITENTE: "TZ01",
  GUIA_TRANSPORTISTA: "VZ01"
} as const;
