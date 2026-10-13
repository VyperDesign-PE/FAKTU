/**
 * Paleta de FAKTU: identidad sobria (azul marino y grises azulados, sin colores de acento en la interfaz).
 * Única fuente de colores: `theme.ts` la usa en nativo y `scripts/sync-palette.ts`
 * la vuelca como variables CSS en public/index.html para la web.
 * Contrastes mínimos (AA) verificados en tests/palette.ts.
 */
export const light = {
  background: "#F3F5F8",
  surface: "#FFFFFF",
  hover: "#F7F9FC",
  tableHead: "#F1F4F8",
  /** Color de marca: botones, enlaces, selección. */
  primary: "#1F4B99",
  /** Texto y enlaces de marca sobre superficies (en oscuro es más claro que `primary`). */
  primaryText: "#1F4B99",
  primaryDark: "#173B7A",
  primarySoft: "#E6EDF8",
  /** Fondo oscuro de marca: menú lateral y barra superior móvil. */
  ink: "#0F1B33",
  inkSoft: "#1A2A47",
  /** Acento de la marca (punto del isotipo). Decorativo: no se usa en la interfaz ni significa un estado. */
  mint: "#19C58B",
  mintSoft: "#DDF4E8",
  /** Texto y detalles sobre el fondo oscuro de marca. */
  onInkMuted: "#B9C4D9",
  onInkAccent: "#8FB0EA",
  onInkWarning: "#F5B544",
  /** Estados: siempre acompañados de texto o icono. Separados del color de marca. */
  success: "#17703F",
  successSoft: "#ECF6F0",
  successBorder: "#BFDCCB",
  warning: "#8A5300",
  warningSoft: "#FBF4E4",
  warningBorder: "#E6CE94",
  danger: "#B42318",
  dangerSoft: "#FDF1F0",
  dangerBorder: "#EFC1BD",
  infoSoft: "#EEF3FA",
  infoBorder: "#C9D6EA",
  mutedSoft: "#EBEEF3",
  /** Acentos de iconos en indicadores (decorativos, siempre con texto). */
  accentViolet: "#5B3FB8",
  accentVioletSoft: "#EFEAFB",
  accentTeal: "#0F6E66",
  accentTealSoft: "#E1F3F0",
  text: "#1A2332",
  muted: "#586374",
  border: "#D8DEE8",
  blue: "#1F4B99"
};

export type ThemeColors = typeof light;

export const dark: ThemeColors = {
  background: "#0C1320",
  surface: "#131C2E",
  hover: "#192438",
  tableHead: "#16203A",
  primary: "#3A66BE",
  primaryText: "#8FB0EA",
  primaryDark: "#2F55A0",
  primarySoft: "#1A2B4D",
  ink: "#0A101D",
  inkSoft: "#172036",
  mint: "#19C58B",
  mintSoft: "#123428",
  onInkMuted: "#B9C4D9",
  onInkAccent: "#8FB0EA",
  onInkWarning: "#F5B544",
  success: "#4CC38A",
  successSoft: "#10281C",
  successBorder: "#1F4A33",
  warning: "#F0B24A",
  warningSoft: "#2E2410",
  warningBorder: "#584318",
  danger: "#F2877E",
  dangerSoft: "#341815",
  dangerBorder: "#642B26",
  infoSoft: "#16233F",
  infoBorder: "#2B3E66",
  mutedSoft: "#1B2740",
  accentViolet: "#B3A1F2",
  accentVioletSoft: "#272047",
  accentTeal: "#6FD3C4",
  accentTealSoft: "#11302D",
  text: "#E6EAF2",
  muted: "#9AA6BA",
  border: "#26324A",
  blue: "#8FB0EA"
};
