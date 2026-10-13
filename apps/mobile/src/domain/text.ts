/**
 * Texto de interfaz: convierte etiquetas escritas TODO EN MAYÚSCULAS a formato oración
 * ("GUARDAR PRODUCTO" -> "Guardar producto"), conservando siglas y la marca WhatsApp.
 * Las etiquetas que ya traen minúsculas no se tocan.
 */
const ACRONYMS: Record<string, string> = { ruc: "RUC", dni: "DNI", pdf: "PDF", sunat: "SUNAT", igv: "IGV", qr: "QR", whatsapp: "WhatsApp" };

export function sentenceCase(text: string) {
  const letters = text.replace(/[^\p{L}]/gu, "");
  if (letters.length < 4 || text !== text.toUpperCase()) return text;
  return text
    .toLowerCase()
    .replace(/\p{L}+/gu, (word) => ACRONYMS[word] ?? word)
    .replace(/^([^\p{L}]*)(\p{L})/u, (_m, lead: string, first: string) => lead + first.toUpperCase())
    .replace(/\bs\//g, "S/");
}
