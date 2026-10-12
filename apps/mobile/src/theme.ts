import { Appearance, Platform } from "react-native";

const light = {
  background: "#F6F7FB",
  surface: "#FFFFFF",
  hover: "#FBF9FF",
  tableHead: "#F8F9FC",
  primary: "#5B2FD5",
  primaryDark: "#4421AE",
  primarySoft: "#EFE9FF",
  /** Fondo del menú lateral y de la barra superior. */
  ink: "#12163A",
  inkSoft: "#1C2150",
  mint: "#19C58B",
  success: "#169B52",
  successSoft: "#EEF9F1",
  successBorder: "#BFE5C9",
  warning: "#B26A00",
  warningSoft: "#FFF7E5",
  warningBorder: "#F3D28A",
  danger: "#B42318",
  dangerSoft: "#FFF1F0",
  dangerBorder: "#F2B8B5",
  infoSoft: "#F2F5FF",
  infoBorder: "#CCD8FB",
  mutedSoft: "#EEF0F5",
  text: "#141A3A",
  muted: "#6B7289",
  border: "#E3E5EE",
  blue: "#2269D8"
};

export type ThemeColors = typeof light;

const dark: ThemeColors = {
  background: "#0B0E24",
  surface: "#151A3B",
  hover: "#1C2250",
  tableHead: "#1A2046",
  primary: "#7C5CFF",
  primaryDark: "#6240F0",
  primarySoft: "#2A2260",
  ink: "#0F1230",
  inkSoft: "#1D2354",
  mint: "#19C58B",
  success: "#3DD68C",
  successSoft: "#12301F",
  successBorder: "#1F5236",
  warning: "#F5B544",
  warningSoft: "#33280E",
  warningBorder: "#5C4818",
  danger: "#FF7A70",
  dangerSoft: "#3A1815",
  dangerBorder: "#6A2B26",
  infoSoft: "#182450",
  infoBorder: "#2C3F85",
  mutedSoft: "#232A57",
  text: "#ECEEFB",
  muted: "#9AA1C7",
  border: "#2A3166",
  blue: "#6EA3FF"
};

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
  radius: { sm: 10, md: 14, lg: 18, xl: 22 }
} as const;

export type ThemeMode = "light" | "dark" | "system";
const STORAGE_KEY = "faktu_theme_mode";

export function getThemeMode(): ThemeMode {
  if (!isWeb) return "system";
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved === "light" || saved === "dark" ? saved : "system";
  } catch {
    return "system";
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
