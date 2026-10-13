/**
 * Paleta de FAKTU (identidad "Ágil": cobalto + menta sobre fondo claro).
 * Única fuente de colores: `theme.ts` la usa en nativo y `scripts/sync-palette.ts`
 * la vuelca como variables CSS en public/index.html para la web.
 * Contrastes mínimos (AA) verificados en tests/palette.ts.
 */
export const light = {
  background: "#F5F7FC",
  surface: "#FFFFFF",
  hover: "#EFF3FF",
  tableHead: "#F1F4FB",
  /** Color de marca: botones, enlaces, selección. */
  primary: "#2547A8",
  /** Texto y enlaces de marca sobre superficies (en oscuro es más claro que `primary`). */
  primaryText: "#2547A8",
  primaryDark: "#1B3787",
  primarySoft: "#E3EAFB",
  /** Fondo del menú lateral, barra superior y tarjeta destacada. */
  ink: "#101A3D",
  inkSoft: "#1A2757",
  /** Acento de la marca (punto del isotipo, detalles). Decorativo: nunca transmite un estado. */
  mint: "#19C58B",
  mintSoft: "#DDF4E8",
  /** Texto y detalles sobre el fondo oscuro de marca (menú, tarjeta destacada). */
  onInkMuted: "#C5CEF0",
  onInkAccent: "#7C98F5",
  onInkWarning: "#F5B544",
  /** Estados: siempre acompañados de texto o icono. Separados del color de marca. */
  success: "#0F7A3E",
  successSoft: "#EAF7EF",
  successBorder: "#B5DFC4",
  warning: "#8A5300",
  warningSoft: "#FFF6E0",
  warningBorder: "#EBCB85",
  danger: "#B42318",
  dangerSoft: "#FFF1F0",
  dangerBorder: "#F2B8B5",
  infoSoft: "#EEF3FF",
  infoBorder: "#C7D4F7",
  mutedSoft: "#ECEFF6",
  text: "#16203F",
  muted: "#55607F",
  border: "#DDE2EE",
  blue: "#2547A8"
};

export type ThemeColors = typeof light;

export const dark: ThemeColors = {
  background: "#0A1127",
  surface: "#121B38",
  hover: "#1A2548",
  tableHead: "#162042",
  primary: "#4568E0",
  primaryText: "#8FA8FF",
  primaryDark: "#3752BD",
  primarySoft: "#1B2B5E",
  ink: "#0D1531",
  inkSoft: "#1A2757",
  mint: "#19C58B",
  mintSoft: "#123428",
  /** Texto y detalles sobre el fondo oscuro de marca (menú, tarjeta destacada). */
  onInkMuted: "#C5CEF0",
  onInkAccent: "#7C98F5",
  onInkWarning: "#F5B544",
  success: "#4CD98F",
  successSoft: "#10301F",
  successBorder: "#1F5236",
  warning: "#F5B544",
  warningSoft: "#33280E",
  warningBorder: "#5C4818",
  danger: "#FF8A80",
  dangerSoft: "#3A1815",
  dangerBorder: "#6A2B26",
  infoSoft: "#16255A",
  infoBorder: "#2C3F85",
  mutedSoft: "#1F2A52",
  text: "#EDF0FB",
  muted: "#A3ACCF",
  border: "#27325F",
  blue: "#8FA8FF"
};
