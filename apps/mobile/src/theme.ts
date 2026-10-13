import { Appearance, Platform } from "react-native";

import { dark, light, type ThemeColors } from "./brand/palette";

export type { ThemeColors };

export const palettes = { light, dark };
const isWeb = Platform.OS === "web";

/**
 * En web los colores son variables CSS (`var(--f-text)`), definidas en index.html
 * para claro y oscuro: cambiar de modo no requiere recargar ni recrear estilos.
 * En celular siguen el modo del sistema al abrir la app.
 */
function resolve(): ThemeColors {
  if (isWeb) return Object.fromEntries(Object.keys(light).map((key) => [key, `var(--f-${key})`])) as ThemeColors;
  return Appearance.getColorScheme() === "dark" ? dark : light;
}

export const theme = {
  colors: resolve(),
  radius: { sm: 8, md: 10, lg: 12, xl: 16 }
} as const;

/** Sombra suave de tarjetas: `boxShadow` en web; elevación mínima en nativo. */
export const cardShadow = (Platform.OS === "web"
  ? { boxShadow: "0 1px 2px rgba(16, 24, 40, 0.05), 0 1px 3px rgba(16, 24, 40, 0.06)" }
  : { elevation: 1 }) as object;

export type ThemeMode = "light" | "dark" | "system";
const STORAGE_KEY = "faktu_theme_mode";

export function getThemeMode(): ThemeMode {
  if (!isWeb) return "system";
  // En web el modo claro es el predeterminado; el oscuro solo si la persona lo elige.
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

/** Modo efectivo en pantalla (resuelve "system" con la preferencia del dispositivo). */
export function effectiveScheme(mode = getThemeMode()): "light" | "dark" {
  if (mode !== "system") return mode;
  if (isWeb && typeof window.matchMedia === "function") return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  return Appearance.getColorScheme() === "dark" ? "dark" : "light";
}

export function setThemeMode(mode: ThemeMode) {
  if (!isWeb) return;
  try {
    if (mode === "system") window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Sin almacenamiento: el modo vale solo para esta sesión.
  }
  if (mode === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", mode);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", effectiveScheme(mode) === "dark" ? dark.ink : light.ink);
}
