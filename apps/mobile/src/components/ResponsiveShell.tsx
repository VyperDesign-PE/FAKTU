import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useApp } from "../context/AppContext";
import { theme } from "../theme";
import { BrandLogo } from "./Brand";

export type MainRouteName = "Dashboard" | "POSVenta" | "HistorialComprobantes" | "Productos" | "PorCobrar" | "Configuracion";

type Props = {
  currentRoute: MainRouteName;
  // Tipo estructural mínimo: cualquier pantalla del stack puede pasar su navigation.
  navigation: { navigate(route: MainRouteName): void };
  children: ReactNode;
  title: string;
  subtitle?: string;
  /** Contenido a la derecha del título (por ejemplo, un botón de acción). */
  action?: ReactNode;
  /** Pantalla completa sin márgenes (el punto de venta controla su propio scroll). */
  fill?: boolean;
};

const NAV_ITEMS: Array<{ route: MainRouteName; label: string; shortLabel: string; icon: string; bottom: boolean }> = [
  { route: "Dashboard", label: "Mi negocio", shortLabel: "Inicio", icon: "◧", bottom: true },
  { route: "POSVenta", label: "Vender", shortLabel: "Vender", icon: "＋", bottom: true },
  { route: "HistorialComprobantes", label: "Comprobantes", shortLabel: "Ventas", icon: "☰", bottom: true },
  { route: "PorCobrar", label: "Por cobrar (fiados)", shortLabel: "Fiados", icon: "$", bottom: true },
  { route: "Productos", label: "Productos y stock", shortLabel: "Productos", icon: "▤", bottom: true },
  { route: "Configuracion", label: "Más opciones", shortLabel: "Más", icon: "⋯", bottom: false }
];

export function ResponsiveShell({ currentRoute, navigation, children, title, subtitle, action, fill }: Props) {
  const { width } = useWindowDimensions();
  const { profile, online, pendingCount } = useApp();
  const desktop = width >= 900;
  const businessName = profile.tradeName ?? profile.businessName ?? "Mi negocio";

  const header = (
    <View style={styles.pageHeader}>
      <View style={{ flex: 1 }}>
        <Text style={styles.pageTitle}>{title}</Text>
        {subtitle ? <Text style={styles.pageSubtitle}>{subtitle}</Text> : null}
      </View>
      {action}
    </View>
  );

  return (
    <View style={styles.root}>
      {desktop ? (
        <View style={styles.sidebar}>
          <View style={styles.brandBox}><BrandLogo size={40} light tagline="Facturación electrónica" /></View>

          <View style={styles.navList}>
            {NAV_ITEMS.map((item) => (
              <NavButton key={item.route} label={item.label} icon={item.icon} active={item.route === currentRoute} onPress={() => navigation.navigate(item.route)} />
            ))}
          </View>

          <View style={styles.sidebarFooter}>
            <Text style={styles.sidebarFooterTitle} numberOfLines={1}>{businessName}</Text>
            <View style={styles.statusRow}>
              <View style={[styles.statusDot, { backgroundColor: online ? theme.colors.mint : "#F5A524" }]} />
              <Text style={styles.sidebarFooterText}>{!online ? "Sin Internet · sigues vendiendo" : pendingCount ? `${pendingCount} por enviar` : "Todo al día"}</Text>
            </View>
          </View>
        </View>
      ) : (
        <View style={styles.topBar}>
          <BrandLogo size={30} light />
          <Pressable accessibilityRole="button" accessibilityLabel="Más opciones" onPress={() => navigation.navigate("Configuracion")} style={styles.topAction}>
            <Text style={styles.topActionText}>⚙</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.contentColumn}>
        {fill ? (
          <View style={[styles.fill, desktop && styles.fillDesktop]}>{header}{children}</View>
        ) : (
          <ScrollView contentContainerStyle={[styles.page, desktop && styles.pageDesktop]}>
            {header}
            {children}
          </ScrollView>
        )}

        {!desktop ? (
          <View style={styles.bottomBar}>
            {NAV_ITEMS.filter((item) => item.bottom).map((item) => {
              const active = item.route === currentRoute;
              const center = item.route === "POSVenta";
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  key={item.route}
                  style={styles.bottomItem}
                  onPress={() => navigation.navigate(item.route)}
                >
                  <View style={[styles.bottomIconWrap, center && styles.centerIcon, active && !center && styles.bottomIconActive]}>
                    <Text style={[styles.bottomIcon, active && styles.activeText, center && { color: "#FFFFFF" }]}>{item.icon}</Text>
                  </View>
                  <Text style={[styles.bottomLabel, active && styles.activeText]}>{item.shortLabel}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </View>
    </View>
  );
}

function NavButton({ label, icon, active, onPress }: { label: string; icon: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ hovered }: { pressed: boolean; hovered?: boolean }) => [styles.navButton, hovered && styles.navHover, active && styles.navButtonActive]}>
      <Text style={[styles.navIcon, active && styles.navTextActive]}>{icon}</Text>
      <Text style={[styles.navLabel, active && styles.navTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: "row", backgroundColor: theme.colors.background },
  sidebar: { width: 252, backgroundColor: theme.colors.ink, padding: 16, gap: 22 },
  brandBox: { paddingVertical: 10, paddingHorizontal: 6 },
  navList: { gap: 4 },
  navButton: { minHeight: 46, borderRadius: 12, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12 },
  navHover: { backgroundColor: theme.colors.inkSoft },
  navButtonActive: { backgroundColor: theme.colors.primary },
  navIcon: { width: 24, textAlign: "center", color: "#8D93C4", fontWeight: "900", fontSize: 17 },
  navLabel: { color: "#C9CCE8", fontWeight: "700" },
  navTextActive: { color: "#FFFFFF" },
  activeText: { color: theme.colors.primary },
  sidebarFooter: { marginTop: "auto", borderRadius: 14, padding: 14, backgroundColor: theme.colors.inkSoft, gap: 6 },
  sidebarFooterTitle: { color: "#FFFFFF", fontWeight: "800" },
  sidebarFooterText: { color: "#A9AED3", fontSize: 12 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  topBar: { position: "absolute", top: 0, left: 0, right: 0, height: 54, zIndex: 5, backgroundColor: theme.colors.ink, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16 },
  topAction: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.inkSoft },
  topActionText: { color: "#FFFFFF", fontSize: 18 },
  contentColumn: { flex: 1 },
  page: { flexGrow: 1, padding: 16, paddingTop: 70, paddingBottom: 96, gap: 16 },
  pageDesktop: { maxWidth: 1180, width: "100%", alignSelf: "center", padding: 28, paddingTop: 28, paddingBottom: 40 },
  fill: { flex: 1, padding: 16, paddingTop: 66, gap: 12 },
  fillDesktop: { padding: 28, paddingTop: 28, maxWidth: 1280, width: "100%", alignSelf: "center" },
  pageHeader: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 4 },
  pageTitle: { color: theme.colors.text, fontWeight: "900", fontSize: 26, letterSpacing: -0.4 },
  pageSubtitle: { color: theme.colors.muted, lineHeight: 21, maxWidth: 780, marginTop: 3 },
  bottomBar: { minHeight: 70, paddingBottom: 6, borderTopWidth: 1, borderTopColor: theme.colors.border, backgroundColor: theme.colors.surface, flexDirection: "row", alignItems: "flex-end" },
  bottomItem: { flex: 1, alignItems: "center", justifyContent: "flex-end", gap: 2, minHeight: 62, paddingBottom: 4 },
  bottomIconWrap: { width: 40, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  bottomIconActive: { backgroundColor: theme.colors.primarySoft },
  centerIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: theme.colors.primary, marginTop: -18, borderWidth: 4, borderColor: theme.colors.surface },
  bottomIcon: { color: theme.colors.muted, fontSize: 18, fontWeight: "900" },
  bottomLabel: { color: theme.colors.muted, fontSize: 10.5, fontWeight: "800" }
});
