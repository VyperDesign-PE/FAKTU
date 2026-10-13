import { StyleSheet, Text, View } from "react-native";
import { theme } from "../theme";
import { MARK_BARS, MARK_DOT, MARK_RADIUS } from "../brand/mark";

/** Isotipo de FAKTU: una "F" blanca sobre cuadro cobalto con el punto menta del comprobante aceptado. */
export function BrandMark({ size = 40 }: { size?: number }) {
  return (
    <View accessible accessibilityRole="image" accessibilityLabel="FAKTU" style={[styles.mark, { width: size, height: size, borderRadius: size * MARK_RADIUS }]}>
      {MARK_BARS.map((bar, index) => (
        <View key={index} style={{ position: "absolute", left: bar.x * size, top: bar.y * size, width: bar.w * size, height: bar.h * size, borderRadius: size * 0.025, backgroundColor: "#FFFFFF" }} />
      ))}
      <View style={{ position: "absolute", left: (MARK_DOT.cx - MARK_DOT.r) * size, top: (MARK_DOT.cy - MARK_DOT.r) * size, width: MARK_DOT.r * 2 * size, height: MARK_DOT.r * 2 * size, borderRadius: MARK_DOT.r * size, backgroundColor: theme.colors.mint }} />
    </View>
  );
}

/** `light` = para fondos oscuros (menú lateral, acceso). La palabra FAKTU siempre en mayúsculas. */
export function BrandLogo({ size = 40, light = false, tagline }: { size?: number; light?: boolean; tagline?: string }) {
  return (
    <View style={styles.row}>
      <BrandMark size={size} />
      <View>
        <Text accessibilityRole="header" style={[styles.word, { fontSize: size * 0.52, color: light ? "#FFFFFF" : theme.colors.text }]}>FAKTU</Text>
        {tagline ? <Text style={[styles.tagline, light && { color: theme.colors.onInkMuted }]}>{tagline}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  mark: { backgroundColor: theme.colors.primary, overflow: "hidden" },
  word: { fontWeight: "700", letterSpacing: 1.5 },
  tagline: { color: theme.colors.muted, fontSize: 12, marginTop: -1 }
});
