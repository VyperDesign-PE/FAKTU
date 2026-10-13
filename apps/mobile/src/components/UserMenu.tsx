import { useState } from "react";
import { Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useApp } from "../context/AppContext";
import { useAuth } from "../context/AuthContext";
import { cardShadow, theme } from "../theme";
import { Icon, type IconName } from "./Icon";

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "F";

const ITEMS: Array<{ route: string; label: string; icon: IconName }> = [
  { route: "Business", label: "Datos del negocio", icon: "building" },
  { route: "Seguridad", label: "Seguridad y sesiones", icon: "shield" },
  { route: "Configuracion", label: "Configuración", icon: "settings" },
  { route: "Support", label: "Ayuda y soporte", icon: "mail" }
];

/**
 * Menú de la cuenta: negocio, correo, accesos de cuenta y "Cerrar sesión".
 * `compact` muestra solo el avatar (barra superior del celular).
 */
export function UserMenu({ compact = false }: { compact?: boolean }) {
  const navigation = useNavigation<{ navigate(route: string): void }>();
  const { profile } = useApp();
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const businessName = profile.tradeName ?? profile.businessName ?? "Mi negocio";

  function go(route: string) {
    setOpen(false);
    navigation.navigate(route);
  }

  async function logout() {
    setLeaving(true);
    try {
      await signOut();
      // En web, la dirección vuelve a la raíz: sin sesión no hay pantallas protegidas que mostrar.
      if (Platform.OS === "web") window.history.replaceState(null, "", "/");
    } finally {
      setLeaving(false);
      setOpen(false);
    }
  }

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Cuenta de ${businessName}: abrir menú`}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(true)}
        style={({ hovered }: { pressed: boolean; hovered?: boolean }) => [compact ? styles.triggerCompact : styles.trigger, hovered && !compact && { backgroundColor: theme.colors.hover }]}
      >
        <View style={styles.avatar}><Text style={styles.avatarText}>{initials(businessName)}</Text></View>
        {compact ? null : (
          <>
            <View style={{ maxWidth: 200 }}>
              <Text style={styles.name} numberOfLines={1}>{businessName}</Text>
              <Text style={styles.meta} numberOfLines={1}>{profile.ruc ? `RUC ${profile.ruc}` : user?.email ?? "Administrador"}</Text>
            </View>
            <Icon name="chevronDown" size={16} color={theme.colors.muted} />
          </>
        )}
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable accessibilityLabel="Cerrar menú" style={styles.overlay} onPress={() => setOpen(false)}>
          <Pressable style={[styles.panel, cardShadow, compact && styles.panelCompact]} onPress={() => undefined}>
            <View style={styles.panelHead}>
              <View style={[styles.avatar, styles.avatarLarge]}><Text style={[styles.avatarText, { fontSize: 16 }]}>{initials(businessName)}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>{businessName}</Text>
                {user?.email ? <Text style={styles.meta} numberOfLines={1}>{user.email}</Text> : null}
                {profile.ruc ? <Text style={styles.meta}>RUC {profile.ruc}</Text> : null}
              </View>
            </View>
            {ITEMS.map((item) => (
              <Pressable key={item.route} accessibilityRole="menuitem" onPress={() => go(item.route)} style={({ hovered }: { pressed: boolean; hovered?: boolean }) => [styles.item, hovered && { backgroundColor: theme.colors.hover }]}>
                <Icon name={item.icon} size={18} color={theme.colors.muted} />
                <Text style={styles.itemText}>{item.label}</Text>
              </Pressable>
            ))}
            <View style={styles.separator} />
            <Pressable accessibilityRole="menuitem" onPress={() => void logout()} disabled={leaving} style={({ hovered }: { pressed: boolean; hovered?: boolean }) => [styles.item, hovered && { backgroundColor: theme.colors.dangerSoft }]}>
              <Icon name="logout" size={18} color={theme.colors.danger} />
              <Text style={[styles.itemText, { color: theme.colors.danger }]}>{leaving ? "Cerrando sesión…" : "Cerrar sesión"}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10, minHeight: 48 },
  triggerCompact: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: theme.colors.primary, alignItems: "center", justifyContent: "center" },
  avatarLarge: { width: 44, height: 44, borderRadius: 22 },
  avatarText: { color: "#FFFFFF", fontWeight: "700", fontSize: 13 },
  name: { color: theme.colors.text, fontWeight: "600", fontSize: 14 },
  meta: { color: theme.colors.muted, fontSize: 12, marginTop: 1 },
  overlay: { flex: 1, backgroundColor: "rgba(10, 16, 29, 0.18)" },
  panel: { position: "absolute", top: 60, right: 20, width: 300, backgroundColor: theme.colors.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, padding: 8 },
  panelCompact: { top: 56, right: 8 },
  panelHead: { flexDirection: "row", alignItems: "center", gap: 12, padding: 10, paddingBottom: 14, marginBottom: 6, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  item: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 44, paddingHorizontal: 10, borderRadius: 8 },
  itemText: { color: theme.colors.text, fontSize: 14, fontWeight: "500" },
  separator: { height: 1, backgroundColor: theme.colors.border, marginVertical: 6 }
});
