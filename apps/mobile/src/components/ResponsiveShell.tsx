import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { theme } from "../theme";

export type MainRouteName = "Dashboard" | "POSVenta" | "HistorialComprobantes" | "Configuracion";

type Props = {
  currentRoute: MainRouteName;
  // Tipo estructural mínimo: cualquier pantalla del stack puede pasar su navigation.
  navigation: { navigate(route: MainRouteName): void };
  children: ReactNode;
  title: string;
  subtitle?: string;
};

const NAV_ITEMS: Array<{ route: MainRouteName; label: string; shortLabel: string; icon: string }> = [
  { route: "Dashboard", label: "Dashboard", shortLabel: "Inicio", icon: "▦" },
  { route: "POSVenta", label: "POS / Venta", shortLabel: "Vender", icon: "+" },
  { route: "HistorialComprobantes", label: "Comprobantes", shortLabel: "Historial", icon: "≡" },
  { route: "Configuracion", label: "Configuración", shortLabel: "Config.", icon: "⚙" }
];

export function ResponsiveShell({ currentRoute, navigation, children, title, subtitle }: Props) {
  const { width } = useWindowDimensions();
  const desktop = width >= 900;

  return (
    <View style={styles.root}>
      {desktop ? (
        <View style={styles.sidebar}>
          <View style={styles.brandBox}>
            <View style={styles.brandMark}><Text style={styles.brandMarkText}>F</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.brandTitle}>Comprobantes Fácil</Text>
              <Text style={styles.brandSubtitle}>MVP SaaS Perú</Text>
            </View>
          </View>

          <View style={styles.navList}>
            {NAV_ITEMS.map((item) => (
              <NavButton
                key={item.route}
                label={item.label}
                icon={item.icon}
                active={item.route === currentRoute}
                onPress={() => navigation.navigate(item.route)}
              />
            ))}
          </View>

          <View style={styles.sidebarFooter}>
            <Text style={styles.sidebarFooterTitle}>Estado del sistema</Text>
            <Text style={styles.sidebarFooterText}>La navegación principal se adapta automáticamente a PC, tablet y celular.</Text>
          </View>
        </View>
      ) : null}

      <View style={styles.contentColumn}>
        <ScrollView contentContainerStyle={[styles.page, desktop && styles.pageDesktop]}>
          <View style={styles.pageHeader}>
            <Text style={styles.pageTitle}>{title}</Text>
            {subtitle ? <Text style={styles.pageSubtitle}>{subtitle}</Text> : null}
          </View>
          {children}
        </ScrollView>

        {!desktop ? (
          <View style={styles.bottomBar}>
            {NAV_ITEMS.map((item) => (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: item.route === currentRoute }}
                key={item.route}
                style={styles.bottomItem}
                onPress={() => navigation.navigate(item.route)}
              >
                <Text style={[styles.bottomIcon, item.route === currentRoute && styles.activeText]}>{item.icon}</Text>
                <Text style={[styles.bottomLabel, item.route === currentRoute && styles.activeText]}>{item.shortLabel}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

function NavButton({ label, icon, active, onPress }: { label: string; icon: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={[styles.navButton, active && styles.navButtonActive]}>
      <Text style={[styles.navIcon, active && styles.activeText]}>{icon}</Text>
      <Text style={[styles.navLabel, active && styles.activeText]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: "row", backgroundColor: theme.colors.background },
  sidebar: { width: 260, backgroundColor: theme.colors.surface, borderRightWidth: 1, borderRightColor: theme.colors.border, padding: 18, gap: 20 },
  brandBox: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
  brandMark: { width: 44, height: 44, borderRadius: 14, backgroundColor: theme.colors.primary, alignItems: "center", justifyContent: "center" },
  brandMarkText: { color: "white", fontWeight: "900", fontSize: 18 },
  brandTitle: { color: theme.colors.text, fontWeight: "900", fontSize: 16 },
  brandSubtitle: { color: theme.colors.muted, fontSize: 12, marginTop: 2 },
  navList: { gap: 8 },
  navButton: { minHeight: 50, borderRadius: 14, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14 },
  navButtonActive: { backgroundColor: theme.colors.primarySoft },
  navIcon: { width: 24, textAlign: "center", color: theme.colors.muted, fontWeight: "900", fontSize: 18 },
  navLabel: { color: theme.colors.muted, fontWeight: "800" },
  activeText: { color: theme.colors.primary },
  sidebarFooter: { marginTop: "auto", borderWidth: 1, borderColor: theme.colors.border, borderRadius: 16, padding: 14, backgroundColor: "#F8F6FF" },
  sidebarFooterTitle: { color: theme.colors.text, fontWeight: "900", marginBottom: 6 },
  sidebarFooterText: { color: theme.colors.muted, lineHeight: 18, fontSize: 12 },
  contentColumn: { flex: 1 },
  page: { flexGrow: 1, padding: 18, paddingBottom: 96, gap: 16 },
  pageDesktop: { maxWidth: 1180, width: "100%", alignSelf: "center", padding: 28, paddingBottom: 40 },
  pageHeader: { gap: 5, paddingVertical: 4 },
  pageTitle: { color: theme.colors.text, fontWeight: "900", fontSize: 26 },
  pageSubtitle: { color: theme.colors.muted, lineHeight: 21, maxWidth: 780 },
  bottomBar: { minHeight: 72, paddingBottom: 8, borderTopWidth: 1, borderTopColor: theme.colors.border, backgroundColor: theme.colors.surface, flexDirection: "row", alignItems: "center" },
  bottomItem: { flex: 1, alignItems: "center", justifyContent: "center", gap: 3, minHeight: 60 },
  bottomIcon: { color: theme.colors.muted, fontSize: 20, fontWeight: "900" },
  bottomLabel: { color: theme.colors.muted, fontSize: 11, fontWeight: "800" }
});
