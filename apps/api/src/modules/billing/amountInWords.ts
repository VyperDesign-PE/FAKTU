const UNITS = ["", "UNO", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO", "NUEVE"];
const TEENS: Record<number, string> = {
  10: "DIEZ", 11: "ONCE", 12: "DOCE", 13: "TRECE", 14: "CATORCE", 15: "QUINCE",
  16: "DIECISEIS", 17: "DIECISIETE", 18: "DIECIOCHO", 19: "DIECINUEVE",
  20: "VEINTE", 21: "VEINTIUNO", 22: "VEINTIDOS", 23: "VEINTITRES", 24: "VEINTICUATRO",
  25: "VEINTICINCO", 26: "VEINTISEIS", 27: "VEINTISIETE", 28: "VEINTIOCHO", 29: "VEINTINUEVE"
};
const TENS: Record<number, string> = { 30: "TREINTA", 40: "CUARENTA", 50: "CINCUENTA", 60: "SESENTA", 70: "SETENTA", 80: "OCHENTA", 90: "NOVENTA" };
const HUNDREDS: Record<number, string> = { 200: "DOSCIENTOS", 300: "TRESCIENTOS", 400: "CUATROCIENTOS", 500: "QUINIENTOS", 600: "SEISCIENTOS", 700: "SETECIENTOS", 800: "OCHOCIENTOS", 900: "NOVECIENTOS" };

function under100(value: number): string {
  if (value < 10) return UNITS[value];
  if (value < 30) return TEENS[value];
  const tens = Math.floor(value / 10) * 10;
  const unit = value % 10;
  return unit ? `${TENS[tens]} Y ${UNITS[unit]}` : TENS[tens];
}

function under1000(value: number): string {
  if (value < 100) return under100(value);
  if (value === 100) return "CIEN";
  const hundreds = Math.floor(value / 100) * 100;
  const rest = value % 100;
  const prefix = hundreds === 100 ? "CIENTO" : HUNDREDS[hundreds];
  return rest ? `${prefix} ${under100(rest)}` : prefix;
}

function integerWords(value: number): string {
  if (value === 0) return "CERO";
  if (value < 1000) return under1000(value);
  if (value < 1_000_000) {
    const thousands = Math.floor(value / 1000);
    const rest = value % 1000;
    const prefix = thousands === 1 ? "MIL" : `${under1000(thousands)} MIL`;
    return rest ? `${prefix} ${under1000(rest)}` : prefix;
  }
  if (value < 1_000_000_000) {
    const millions = Math.floor(value / 1_000_000);
    const rest = value % 1_000_000;
    const prefix = millions === 1 ? "UN MILLON" : `${integerWords(millions)} MILLONES`;
    return rest ? `${prefix} ${integerWords(rest)}` : prefix;
  }
  throw new Error("Monto fuera del rango soportado para la leyenda SUNAT");
}

function apocopateUno(text: string) {
  return text.replace(/VEINTIUNO$/u, "VEINTIUN").replace(/ Y UNO$/u, " Y UN").replace(/ UNO$/u, " UN").replace(/^UNO$/u, "UN");
}

export function amountInWordsPen(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Monto invalido");
  const rounded = Math.round((amount + Number.EPSILON) * 100) / 100;
  let integer = Math.floor(rounded);
  let cents = Math.round((rounded - integer) * 100);
  if (cents === 100) {
    integer += 1;
    cents = 0;
  }
  const words = apocopateUno(integerWords(integer));
  return `SON ${words} CON ${String(cents).padStart(2, "0")}/100 SOLES`;
}
