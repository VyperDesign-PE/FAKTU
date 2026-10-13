/**
 * Reglas de documento que el celular valida antes de enviar. El servidor las vuelve a validar
 * (apps/api/src/modules/receipts/documentRules.ts) y es la autoridad; tests/domain.ts comprueba
 * que ambos coincidan. No son asesoría tributaria: replican el comportamiento vigente del código.
 */
export const BOLETA_IDENTIFICATION_THRESHOLD_PEN = 700;
export const DOCUMENT_LENGTH = { DNI: 8, RUC: 11 } as const;

const RUC_PATTERN = /^(10|15|16|17|20)\d{9}$/;
const DNI_PATTERN = /^\d{8}$/;

export const isValidDni = (value: string) => DNI_PATTERN.test(value);
export const isValidRuc = (value: string) => RUC_PATTERN.test(value);

/** ¿Hay que identificar al cliente? Factura, fiado o boleta sobre el umbral. */
export function mustIdentifyCustomer(input: { documentType: "BOLETA" | "FACTURA"; total: number; paymentMethod?: string }) {
  return input.documentType === "FACTURA" || input.paymentMethod === "CREDITO" || input.total > BOLETA_IDENTIFICATION_THRESHOLD_PEN;
}

/** El fiado solo se registra con boleta (comportamiento actual del POS). */
export const creditRequiresBoleta = (paymentMethod?: string) => paymentMethod === "CREDITO";
