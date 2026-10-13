import { createElement, type ReactNode } from "react";
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { theme } from "../theme";

/**
 * Fondo de marca: degradado azul marino → azul con una retícula sutil y dos halos de luz.
 * En web se dibuja con CSS (sin imágenes ni librerías); en nativo queda el color sólido de marca.
 */
const LAYERS = [
  "radial-gradient(circle at 85% 12%, rgba(96, 140, 230, 0.45), transparent 42%)",
  "radial-gradient(circle at 8% 92%, rgba(25, 197, 139, 0.16), transparent 38%)",
  "linear-gradient(rgba(255, 255, 255, 0.045) 1px, transparent 1px)",
  "linear-gradient(90deg, rgba(255, 255, 255, 0.045) 1px, transparent 1px)",
  "linear-gradient(135deg, #0F1B33 0%, #15306A 55%, #1F4B99 100%)"
];
const SIZES = ["100% 100%", "100% 100%", "32px 32px", "32px 32px", "100% 100%"];

export function BrandBackdrop({ children, style }: { children?: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.base, style]}>
      {Platform.OS === "web"
        ? createElement("div", { "aria-hidden": true, style: { position: "absolute", inset: 0, pointerEvents: "none", backgroundImage: LAYERS.join(", "), backgroundSize: SIZES.join(", ") } })
        : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: { backgroundColor: theme.colors.ink, overflow: "hidden" }
});
