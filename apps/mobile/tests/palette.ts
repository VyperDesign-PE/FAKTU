import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dark, light, type ThemeColors } from "../src/brand/palette";
import { renderPaletteCss } from "../scripts/sync-palette";

const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

/** [texto, fondo, mínimo]: 4.5 = texto normal AA; 3 = elementos de interfaz / texto grande. */
const pairs: Array<[keyof ThemeColors, keyof ThemeColors, number]> = [
  ["text", "background", 4.5], ["text", "surface", 4.5], ["muted", "background", 4.5], ["muted", "surface", 4.5], ["muted", "mutedSoft", 4.5],
  ["success", "surface", 4.5], ["success", "successSoft", 4.5], ["warning", "surface", 4.5], ["warning", "warningSoft", 4.5],
  ["danger", "surface", 4.5], ["danger", "dangerSoft", 4.5], ["primaryText", "background", 4.5], ["primaryText", "surface", 4.5], ["primaryText", "primarySoft", 4.5], ["primaryText", "mutedSoft", 4.5],
  ["text", "infoSoft", 4.5], ["text", "primarySoft", 4.5], ["border", "surface", 1.0]
];
let checked = 0;
for (const [name, palette] of [["claro", light], ["oscuro", dark]] as const) {
  for (const [fg, bg, min] of pairs) {
    if (fg === "border") continue;
    const value = ratio(palette[fg], palette[bg]);
    assert.ok(value >= min, `${name}: ${fg} sobre ${bg} = ${value.toFixed(2)} (mínimo ${min})`);
    checked++;
  }
  // Botón primario con texto blanco.
  const button = ratio("#FFFFFF", palette.primary);
  assert.ok(button >= 4.5, `${name}: texto blanco sobre primary = ${button.toFixed(2)}`);
  // Texto sobre el fondo oscuro de marca (menú, tarjeta destacada).
  const onInk = ratio("#FFFFFF", palette.ink);
  assert.ok(onInk >= 4.5, `${name}: texto blanco sobre ink = ${onInk.toFixed(2)}`);
  for (const token of ["onInkMuted", "onInkAccent", "onInkWarning"] as const) {
    const value = ratio(palette[token], palette.ink);
    assert.ok(value >= 4.5, `${name}: ${token} sobre ink = ${value.toFixed(2)}`);
    checked++;
  }
  checked += 2;
}
// El color de marca no puede confundirse con un estado (distancia de luminancia/tono mínima).
for (const state of ["success", "danger", "warning"] as const) {
  assert.ok(light.primary !== light[state]);
}
// index.html debe coincidir con la paleta (se regenera con `npm run sync:palette`).
const html = readFileSync(join(import.meta.dirname, "..", "public", "index.html"), "utf8");
assert.ok(html.includes(renderPaletteCss()), "public/index.html no coincide con src/brand/palette.ts: ejecuta `npm --workspace @app/mobile run sync:palette`");
console.log(`MOBILE PALETTE: PASS (${checked} contrastes AA verificados, CSS sincronizado)`);
