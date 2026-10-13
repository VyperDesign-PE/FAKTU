import type { ReactNode } from "react";
import { useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { useApp } from "../context/AppContext";
import { cardShadow, effectiveScheme, getThemeMode, setThemeMode, theme } from "../theme";
import { BrandLogo } from "./Brand";
import { Icon, type IconName } from "./Icon";

export type MainRouteName = "Dashboard" | "POSVenta" | "HistorialComprobantes" | "Productos" | "PorCobrar" | "Configuracion";

type Props = {
  currentRoute: MainRouteName;
  /** Se conserva por compatibilidad: la navegación real se obtiene con useNavigation. */
  navigation?: unknown;
  children: ReactNode;
  title: string;
  subtitle?: string;
  /** Contenido a la derecha del título (por ejemplo, un botón de acción). */
  action?: ReactNode;
  /** Pantalla completa sin márgenes (el punto de venta controla su propio scroll). */
  fill?: boolean;
};

type NavItem = { route: string; label: string; shortLabel?: string; icon: IconName; bottom?: boolean };

/** Menú principal (también la barra inferior en el celular, con `bottom`). */
const MAIN_ITEMS: Array<NavItem & { route: MainRouteName }> = [
  { route: "Dashboard", label: "Resumen", shortLabel: "Inicio", icon: "home", bottom: true },
  { route: "POSVenta", label: "Vender", icon: "cart", bottom: true },
  { route: "HistorialComprobantes", label: "Historial", icon: "receipt", bottom: true },
  { route: "PorCobrar", label: "Por cobrar", icon: "wallet", bottom: true },
  { route: "Productos", label: "Productos y stock", icon: "box" },
  { route: "Configuracion", label: "Más", icon: "more", bottom: true }
];

/** Atajos de gestión que solo aparecen en el menú lateral de escritorio. */
const MANAGE_ITEMS: NavItem[] = [
  { route: "Customers", label: "Clientes", icon: "users" },
  { route: "Guides", label: "Guías de remisión", icon: "truck" },
  { route: "CashClose", label: "Cierre de caja", icon: "file" },
  { route: "Seguridad", label: "Seguridad", icon: "shield" }
];

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "F";

/** Alterna claro/oscuro (solo web; en el celular se sigue el modo del sistema). */
function ThemeToggle({ onInk }: { onInk?: boolean }) {
  const [scheme, setScheme] = useState<"light" | "dark">(() => effectiveScheme(getThemeMode()));
  if (Platform.OS !== "web") return null;
  const next = scheme === "dark" ? "light" : "dark";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={scheme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
      onPress={() => { setThemeMode(next); setScheme(next); }}
      style={({ hovered }: { pressed: boolean; hovered?: boolean }) => [styles.iconButton, onInk && styles.iconButtonOnInk, hovered && { opacity: 0.8 }]}
    >
      <Icon name={scheme === "dark" ? "sun" : "moon"} size={18} color={onInk ? theme.colors.onInkMuted : theme.colors.muted} />
    </Pressable>
  );
}

/** Botón "Volver": solo aparece cuando hay una pantalla anterior en el historial de navegación. */
export function BackButton({ onInk }: { onInk?: boolean }) {
  const navigation = useNavigation();
  if (!navigation.canGoBack()) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Volver a la pantalla anterior"
      onPress={() => navigation.goBack()}
      style={({ hovered }: { pressed: boolean; hovered?: boolean }) => [styles.backButton, onInk && styles.backButtonOnInk, hovered && { opacity: 0.8 }]}
    >
      <Icon name="back" size={18} color={onInk ? "#FFFFFF" : theme.colors.text} />
      <Text style={[styles.backText, onInk && { color: "#FFFFFF" }]}>Volver</Text>
    </Pressable>
  );
}

/**
 * Marco de escritorio: menú lateral + barra superior (Volver, estado, tema, negocio).
 * Lo usan las pantallas principales (ResponsiveShell) y las secundarias (Screen) para que
 * la navegación sea la misma en todas partes. El ítem activo sale de la ruta actual.
 */
export function DesktopFrame({ children }: { children: ReactNode }) {
  const navigation = useNavigation<{ navigate(route: string): void }>();
  const routeName = useRoute().name;
  const { profile, online, pendingCount } = useApp();
  const businessName = profile.tradeName ?? profile.businessName ?? "Mi negocio";
  const statusLabel = !online ? "Sin conexión" : pendingCount ? `${pendingCount} por enviar` : "Conectado";
  const warn = !online || pendingCount > 0;
  const productos = MAIN_ITEMS.find((item) => item.route === "Productos")!;

  return (
    <View style={styles.root}>
      <View style={styles.sidebar}>
        <View style={styles.brandBox}><BrandLogo size={36} light /></View>
        <ScrollView contentContainerStyle={styles.navScroll}>
          <Text style={styles.navSection}>Principal</Text>
          {MAIN_ITEMS.filter((item) => item.route !== "Productos" && item.route !== "Configuracion").map((item) => (
            <NavButton key={item.route} item={item} active={item.route === routeName} onPress={() => navigation.navigate(item.route)} />
          ))}
          <Text style={styles.navSection}>Gestión</Text>
          <NavButton item={productos} active={routeName === "Productos"} onPress={() => navigation.navigate("Productos")} />
          {MANAGE_ITEMS.map((item) => (
            <NavButton key={item.route} item={item} active={item.route === routeName} onPress={() => navigation.navigate(item.route)} />
          ))}
        </ScrollView>
        <View style={styles.sidebarFooter}>
          <NavButton item={{ route: "Configuracion", label: "Configuración", icon: "settings" }} active={routeName === "Configuracion"} onPress={() => navigation.navigate("Configuracion")} />
        </View>
      </View>

      <View style={styles.contentColumn}>
        <View style={styles.desktopBar}>
          <BackButton />
          <View style={{ flex: 1 }} />
          <View style={[styles.statusPill, warn ? styles.statusWarn : styles.statusOk]} accessibilityLabel={`Estado: ${statusLabel}`}>
            <View style={[styles.statusDot, { backgroundColor: warn ? theme.colors.warning : theme.colors.success }]} />
            <Text style={[styles.statusText, { color: warn ? theme.colors.warning : theme.colors.success }]}>{statusLabel}</Text>
          </View>
          <ThemeToggle />
          <View style={styles.userChip}>
            <View style={styles.avatar}><Text style={styles.avatarText}>{initials(businessName)}</Text></View>
            <View>
              <Text style={styles.userName} numberOfLines={1}>{businessName}</Text>
              <Text style={styles.userMeta}>{profile.ruc ? `RUC ${profile.ruc}` : "Administrador"}</Text>
            </View>
          </View>
        </View>
        {children}
      </View>
    </View>
  );
}

export function ResponsiveShell({ currentRoute, children, title, subtitle, action, fill }: Props) {
  const navigation = useNavigation<{ navigate(route: string): void }>();
  const { width } = useWindowDimensions();
  const desktop = width >= 900;

  const header = (
    <View style={styles.pageHeader}>
      <View style={{ flex: 1, minWidth: 200 }}>
        <Text accessibilityRole="header" style={styles.pageTitle}>{title}</Text>
        {subtitle ? <Text style={styles.pageSubtitle}>{subtitle}</Text> : null}
      </View>
      {action}
    </View>
  );

  const body = fill ? (
    <View style={[styles.fill, desktop && styles.fillDesktop]}>{header}{children}</View>
  ) : (
    <ScrollView contentContainerStyle={[styles.page, desktop && styles.pageDesktop]}>
      {header}
      {children}
    </ScrollView>
  );

  if (desktop) return <DesktopFrame>{body}</DesktopFrame>;

  return (
    <View style={styles.root}>
      <View style={styles.topBar}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <BackButton onInk />
          <BrandLogo size={28} light />
        </View>
        <ThemeToggle onInk />
      </View>
      <View style={styles.contentColumn}>
        {body}
        <View style={styles.bottomBar}>
          {MAIN_ITEMS.filter((item) => item.bottom).map((item) => {
            const active = item.route === currentRoute;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                key={item.route}
                style={styles.bottomItem}
                onPress={() => navigation.navigate(item.route)}
              >
                <View style={[styles.bottomIconWrap, active && styles.bottomIconActive]}>
                  <Icon name={item.icon} size={20} color={active ? theme.colors.primaryText : theme.colors.muted} />
                </View>
                <Text style={[styles.bottomLabel, active && styles.activeText]}>{item.shortLabel ?? item.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

function NavButton({ item, active, onPress }: { item: NavItem; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ hovered }: { pressed: boolean; hovered?: boolean }) => [styles.navButton, hovered && !active && styles.navHover, active && styles.navButtonActive]}
    >
      <Icon name={item.icon} size={19} color={active ? "#FFFFFF" : theme.colors.onInkMuted} />
      <Text style={[styles.navLabel, active && styles.navTextActive]}>{item.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: "row", backgroundColor: theme.colors.background },
  sidebar: { width: 248, backgroundColor: theme.colors.ink, paddingVertical: 18, paddingHorizontal: 14 },
  brandBox: { paddingHorizontal: 8, paddingBottom: 18 },
  navScroll: { gap: 4, paddingBottom: 12 },
  navSection: { color: theme.colors.onInkMuted, opacity: 0.7, fontSize: 11, fontWeight: "600", letterSpacing: 1, textTransform: "uppercase", paddingHorizontal: 12, paddingTop: 14, paddingBottom: 6 },
  navButton: { minHeight: 44, borderRadius: 10, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12 },
  navHover: { backgroundColor: theme.colors.inkSoft },
  navButtonActive: { backgroundColor: theme.colors.primary },
  navLabel: { color: theme.colors.onInkMuted, fontWeight: "500", fontSize: 14 },
  navTextActive: { color: "#FFFFFF", fontWeight: "600" },
  activeText: { color: theme.colors.primaryText, fontWeight: "600" },
  sidebarFooter: { borderTopWidth: 1, borderTopColor: theme.colors.inkSoft, paddingTop: 12 },
  desktopBar: { minHeight: 64, backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.border, flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 28 },
  iconButton: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
  iconButtonOnInk: { borderColor: theme.colors.inkSoft, backgroundColor: theme.colors.inkSoft },
  backButton: { minHeight: 40, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
  backButtonOnInk: { borderColor: theme.colors.inkSoft, backgroundColor: theme.colors.inkSoft },
  backText: { color: theme.colors.text, fontWeight: "600", fontSize: 14 },
  statusPill: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 32, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1 },
  statusOk: { backgroundColor: theme.colors.successSoft, borderColor: theme.colors.successBorder },
  statusWarn: { backgroundColor: theme.colors.warningSoft, borderColor: theme.colors.warningBorder },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 13, fontWeight: "600" },
  userChip: { flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 14, borderLeftWidth: 1, borderLeftColor: theme.colors.border },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: theme.colors.primarySoft, alignItems: "center", justifyContent: "center" },
  avatarText: { color: theme.colors.primaryText, fontWeight: "700", fontSize: 13 },
  userName: { color: theme.colors.text, fontWeight: "600", fontSize: 14, maxWidth: 200 },
  userMeta: { color: theme.colors.muted, fontSize: 12 },
  topBar: { position: "absolute", top: 0, left: 0, right: 0, height: 56, zIndex: 5, backgroundColor: theme.colors.ink, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12 },
  contentColumn: { flex: 1 },
  page: { flexGrow: 1, padding: 16, paddingTop: 72, paddingBottom: 96, gap: 16 },
  pageDesktop: { maxWidth: 1280, width: "100%", alignSelf: "flex-start", padding: 28, paddingTop: 24, paddingBottom: 40 },
  fill: { flex: 1, padding: 16, paddingTop: 72, gap: 12 },
  fillDesktop: { padding: 28, paddingTop: 24, maxWidth: 1360, width: "100%", alignSelf: "flex-start" },
  pageHeader: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 12, paddingVertical: 2 },
  pageTitle: { color: theme.colors.text, fontWeight: "700", fontSize: 24, letterSpacing: -0.3 },
  pageSubtitle: { color: theme.colors.muted, lineHeight: 21, maxWidth: 780, marginTop: 4 },
  bottomBar: { minHeight: 64, paddingBottom: 4, borderTopWidth: 1, borderTopColor: theme.colors.border, backgroundColor: theme.colors.surface, flexDirection: "row", alignItems: "center", ...(cardShadow as object) },
  bottomItem: { flex: 1, alignItems: "center", justifyContent: "center", gap: 3, minHeight: 60 },
  bottomIconWrap: { width: 48, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  bottomIconActive: { backgroundColor: theme.colors.primarySoft },
  bottomLabel: { color: theme.colors.muted, fontSize: 11, fontWeight: "500" }
});
