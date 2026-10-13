import { Pressable, StyleSheet, Text, View } from "react-native";
import { theme } from "../theme";
import { Icon, type IconName } from "./Icon";

type Props = { online: boolean; pendingCount: number; onPress: () => void };

/** Aviso de conexión y de comprobantes por enviar. Solo aparece cuando hay algo que decir (sin conexión o pendientes). */
export function SystemStatusBanner({ online, pendingCount, onPress }: Props) {
  if (online && pendingCount === 0) return null;
  const mode = !online ? "offline" : "pending";
  const copy: { icon: IconName; title: string; body: string } = !online
    ? { icon: "wifi", title: "Sin conexión a Internet", body: "Puedes seguir vendiendo: las ventas se guardan en este dispositivo y se envían al volver la conexión." }
    : { icon: "clock", title: `${pendingCount} comprobante${pendingCount === 1 ? "" : "s"} por enviar`, body: "Se envían automáticamente. Toca para ver el detalle." };

  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={[styles.box, styles[mode]]}>
      <Icon name={copy.icon} size={20} color={theme.colors.warning} />
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{copy.title}</Text>
        <Text style={styles.body}>{copy.body}</Text>
      </View>
      <Icon name="chevron" size={18} color={theme.colors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 10, borderWidth: 1, minHeight: 56 },
  offline: { backgroundColor: theme.colors.warningSoft, borderColor: theme.colors.warningBorder },
  pending: { backgroundColor: theme.colors.warningSoft, borderColor: theme.colors.warningBorder },
  title: { fontWeight: "600", fontSize: 14, color: theme.colors.text },
  body: { color: theme.colors.muted, marginTop: 2, lineHeight: 18, fontSize: 13 }
});
