/**
 * Vuelca src/brand/palette.ts como variables CSS (--f-*) entre los marcadores
 * `palette:start` / `palette:end` de public/index.html.
 * Uso: npm --workspace @app/mobile run sync:palette
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dark, light, type ThemeColors } from "../src/brand/palette";

const vars = (colors: ThemeColors, pad: string) => Object.entries(colors).map(([key, value]) => `${pad}--f-${key}: ${value};`).join("\n");

export function renderPaletteCss() {
  return [
    "/* palette:start (generado desde src/brand/palette.ts; no editar a mano) */",
    "      :root {", vars(light, "        "), "        color-scheme: light;", "      }",
    "      @media (prefers-color-scheme: dark) {",
    '        :root:not([data-theme="light"]) {', vars(dark, "          "), "          color-scheme: dark;", "        }", "      }",
    '      :root[data-theme="dark"] {', vars(dark, "        "), "        color-scheme: dark;", "      }",
    "      /* palette:end */"
  ].join("\n");
}

if (process.argv[1]?.endsWith("sync-palette.ts")) {
  const file = join(import.meta.dirname, "..", "public", "index.html");
  const html = readFileSync(file, "utf8");
  const pattern = /\/\* palette:start[\s\S]*?\/\* palette:end \*\//;
  if (!pattern.test(html)) throw new Error("Faltan los marcadores palette:start / palette:end en public/index.html");
  writeFileSync(file, html.replace(pattern, () => renderPaletteCss()));
  console.log("public/index.html actualizado desde la paleta.");
}
