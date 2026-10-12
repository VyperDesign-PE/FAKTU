import { Pressable, StyleSheet, Text, View } from "react-native";
import { theme } from "../theme";

type Props = { online: boolean; pendingCount: number; onPress: () => void };

export function SystemStatusBanner({ online, pendingCount, onPress }: Props) {
  const mode = !online ? "offline" : pendingCount > 0 ? "pending" : "ok";
  const copy = {
    ok: { icon: "✓", title: "Todo funciona correctamente", body: "Puedes emitir tus comprobantes sin problemas." },
    offline: { icon: "⌁", title: "Sin Internet", body: "Puedes seguir vendiendo. Tus ventas se guardarán." },
    pending: { icon: "◷", title: `Tienes ${pendingCount} comprobante${pendingCount === 1 ? "" : "s"} pendiente${pendingCount === 1 ? "" : "s"}`, body: "Los enviaremos automáticamente." }
  }[mode];

  return (
    <Pressable onPress={onPress} style={[styles.box, styles[mode]]}>
      <View style={styles.icon}><Text style={styles.iconText}>{copy.icon}</Text></View>
      <View style={{ flex: 1 }}><Text style={styles.title}>{copy.title}</Text><Text style={styles.body}>{copy.body}</Text></View>
      <Text style={styles.arrow}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 16, borderWidth: 1 },
  ok: { backgroundColor: theme.colors.successSoft, borderColor: theme.colors.successBorder },
  offline: { backgroundColor: theme.colors.warningSoft, borderColor: theme.colors.warningBorder },
  pending: { backgroundColor: theme.colors.warningSoft, borderColor: theme.colors.warningBorder },
  icon: { width: 34, height: 34, borderRadius: 17, backgroundColor: theme.colors.surface, alignItems: "center", justifyContent: "center" },
  iconText: { color: theme.colors.text, fontSize: 20, fontWeight: "800" },
  title: { fontWeight: "800", fontSize: 15, color: theme.colors.text },
  body: { color: theme.colors.muted, marginTop: 3, lineHeight: 18 },
  arrow: { fontSize: 28, color: theme.colors.muted }
});
