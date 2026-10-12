import { StyleSheet, Text, View } from "react-native";
import { theme } from "../theme";

/** Isotipo de FAKTU: una "F" sobre cuadro violeta con el punto menta del comprobante aceptado. */
export function BrandMark({ size = 40 }: { size?: number }) {
  return (
    <View style={[styles.mark, { width: size, height: size, borderRadius: size * 0.3 }]}>
      <Text style={[styles.markText, { fontSize: size * 0.58, lineHeight: size * 0.72 }]}>F</Text>
      <View style={[styles.dot, { width: size * 0.2, height: size * 0.2, borderRadius: size * 0.1, top: size * 0.14, right: size * 0.14 }]} />
    </View>
  );
}

export function BrandLogo({ size = 40, light = false, tagline }: { size?: number; light?: boolean; tagline?: string }) {
  return (
    <View style={styles.row}>
      <BrandMark size={size} />
      <View>
        <Text style={[styles.word, { fontSize: size * 0.6, color: light ? "#FFFFFF" : theme.colors.text }]}>Faktu</Text>
        {tagline ? <Text style={[styles.tagline, light && { color: "#A9AED3" }]}>{tagline}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  mark: { backgroundColor: theme.colors.primary, alignItems: "center", justifyContent: "center" },
  markText: { color: "#FFFFFF", fontWeight: "900", marginTop: -2 },
  dot: { position: "absolute", backgroundColor: theme.colors.mint },
  word: { fontWeight: "900", letterSpacing: -0.3 },
  tagline: { color: theme.colors.muted, fontSize: 11, marginTop: -1 }
});
