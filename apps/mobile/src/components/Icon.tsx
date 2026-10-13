import { createElement } from "react";
import { Platform, Text } from "react-native";

/**
 * Iconos de línea (trazo 2, 24×24) para la web. En nativo no hay librería de SVG instalada,
 * así que se muestra un símbolo de texto equivalente.
 */
const PATHS = {
  home: ["M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z", "M9 22V12h6v10"],
  plus: ["M12 5v14", "M5 12h14"],
  cart: ["M6 6h15l-1.5 9h-12z", "M6 6L5 3H2", "M9 20h.01", "M18 20h.01"],
  receipt: ["M4 2v20l3-2 2.5 2L12 20l2.5 2L17 20l3 2V2l-3 2-2.5-2L12 4 9.5 2 7 4z", "M8 9h8", "M8 13h8"],
  card: ["M3 5h18a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z", "M1 10h22"],
  box: ["M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z", "M3.27 6.96L12 12.01l8.73-5.05", "M12 22.08V12"],
  users: ["M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2", "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M23 21v-2a4 4 0 0 0-3-3.87", "M16 3.13a4 4 0 0 1 0 7.75"],
  settings: ["M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"],
  more: ["M12 12h.01", "M19 12h.01", "M5 12h.01"],
  back: ["M19 12H5", "M12 19l-7-7 7-7"],
  chevron: ["M9 18l6-6-6-6"],
  sun: ["M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z", "M12 1v2", "M12 21v2", "M4.22 4.22l1.42 1.42", "M18.36 18.36l1.42 1.42", "M1 12h2", "M21 12h2", "M4.22 19.78l1.42-1.42", "M18.36 5.64l1.42-1.42"],
  moon: ["M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"],
  check: ["M20 6L9 17l-5-5"],
  alert: ["M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z", "M12 9v4", "M12 17h.01"],
  wifi: ["M5 12.55a11 11 0 0 1 14.08 0", "M1.42 9a16 16 0 0 1 21.16 0", "M8.53 16.11a6 6 0 0 1 6.95 0", "M12 20h.01"],
  clock: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "M12 6v6l4 2"],
  trend: ["M23 6l-9.5 9.5-5-5L1 18", "M17 6h6v6"],
  shield: ["M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"],
  file: ["M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z", "M14 2v6h6", "M16 13H8", "M16 17H8"],
  truck: ["M1 3h15v13H1z", "M16 8h4l3 3v5h-7z", "M5.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z", "M18.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z"],
  wallet: ["M21 12V7a2 2 0 0 0-2-2H5a2 2 0 0 1 0-4h14v4", "M3 5v14a2 2 0 0 0 2 2h16v-5", "M18 12a2 2 0 0 0 0 4h4v-4z"],
  eye: ["M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z", "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"],
  eyeOff: ["M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94", "M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19", "M14.12 14.12a3 3 0 1 1-4.24-4.24", "M1 1l22 22"],
  logout: ["M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4", "M16 17l5-5-5-5", "M21 12H9"],
  user: ["M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2", "M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"],
  lock: ["M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z", "M7 11V7a5 5 0 0 1 10 0v4"],
  chevronDown: ["M6 9l6 6 6-6"],
  zap: ["M13 2L3 14h9l-1 8 10-12h-9l1-8z"],
  building: ["M3 21h18", "M5 21V7l8-4v18", "M19 21V11l-6-4", "M9 9v.01", "M9 12v.01", "M9 15v.01", "M9 18v.01"],
  mail: ["M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z", "M22 6l-10 7L2 6"]
} as const;

export type IconName = keyof typeof PATHS;

const FALLBACK: Record<IconName, string> = {
  home: "⌂", plus: "+", cart: "⌑", receipt: "☰", card: "▭", box: "▤", users: "☺", settings: "⚙", more: "⋯", back: "←", chevron: "›",
  sun: "☀", moon: "☾", check: "✓", alert: "!", wifi: "◠", clock: "◷", trend: "↗", shield: "◇", file: "▤", truck: "⇢", wallet: "▭",
  eye: "◉", eyeOff: "◎", logout: "⇥", user: "☺", lock: "⚿", chevronDown: "⌄", zap: "ϟ", building: "▦", mail: "✉"
};

export function Icon({ name, size = 20, color = "currentColor", strokeWidth = 2 }: { name: IconName; size?: number; color?: string; strokeWidth?: number }) {
  if (Platform.OS !== "web") return <Text style={{ color, fontSize: size, lineHeight: size + 2, width: size, textAlign: "center" }}>{FALLBACK[name]}</Text>;
  return createElement(
    "svg",
    { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: color, strokeWidth, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true, focusable: "false", style: { flexShrink: 0 } },
    PATHS[name].map((d) => createElement("path", { key: d, d }))
  );
}
