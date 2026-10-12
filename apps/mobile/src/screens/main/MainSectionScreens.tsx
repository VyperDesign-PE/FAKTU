import { useEffect, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/types";
import { ResponsiveShell } from "../../components/ResponsiveShell";
import { Card, PrimaryButton, SectionTitle } from "../../components/Ui";
import { SystemStatusBanner } from "../../components/SystemStatusBanner";
import { useApp } from "../../context/AppContext";
import { ReceiptList } from "../management/ManagementScreens";
import { getBillingSettings, getDailyClose, getInsights, type BillingSettings, type DailyClose, type Insights } from "../../services/api";
import { theme } from "../../theme";

type Props<Name extends keyof RootStackParamList> = NativeStackScreenProps<RootStackParamList, Name>;

const money = (value: number) => `S/ ${value.toFixed(2)}`;
const DAY_LETTERS = ["D", "L", "M", "M", "J", "V", "S"];

function deltaText(today: number, before: number) {
  if (before <= 0) return today > 0 ? "Primer día con ventas para comparar" : "Aún sin ventas";
  const pct = Math.round(((today - before) / before) * 100);
  return pct === 0 ? "Igual que ayer" : `${pct > 0 ? "▲" : "▼"} ${Math.abs(pct)}% vs ayer`;
}

export function DashboardScreen({ navigation }: Props<"Dashboard">) {
  const { online, pendingCount, profile, queue, history, resetDraft } = useApp();
  const [today, setToday] = useState<DailyClose>();
  const [insights, setInsights] = useState<Insights>();
  const [billing, setBilling] = useState<BillingSettings>();
  useEffect(() => { if (online) getBillingSettings().then(setBilling).catch(() => undefined); }, [online]);
  const testMode = billing?.providerCode === "mock" || (billing ? !billing.credentialConfigured : false);
  const business = profile.tradeName ?? profile.businessName ?? "tu negocio";

  // Métricas reales desde el servidor (todas las cajas del negocio).
  useEffect(() => {
    if (!online) return;
    getDailyClose().then(setToday).catch(() => undefined);
    getInsights().then(setInsights).catch(() => undefined);
  }, [online, queue.length, history.length]);

  const todayTotal = insights?.today.total ?? today?.netTotal;
  const maxBar = Math.max(1, ...(insights?.week.series.map((day) => day.total) ?? [1]));

  function startSale() {
    resetDraft();
    navigation.navigate("POSVenta");
  }

  function shareSummary() {
    if (!insights) return;
    const lines = [
      `📊 Resumen de ${business} — ${insights.date}`,
      `Ventas de hoy: ${money(insights.today.total)} (${insights.today.count} comprobantes)`,
      deltaText(insights.today.total, insights.yesterday),
      ...(insights.receivables.total > 0 ? [`Por cobrar (fiados): ${money(insights.receivables.total)} de ${insights.receivables.customers} cliente(s)`] : []),
      ...(insights.lowStock.length ? [`Stock bajo: ${insights.lowStock.slice(0, 4).map((p) => p.name).join(", ")}`] : []),
      "— Enviado desde FAKTU"
    ];
    void Linking.openURL(`https://wa.me/?text=${encodeURIComponent(lines.join("\n"))}`);
  }

  return (
    <ResponsiveShell
      currentRoute="Dashboard"
      navigation={navigation}
      title={`Hola, ${business}`}
      subtitle="Así va tu negocio hoy."
      action={<View style={{ width: 170 }}><PrimaryButton label="＋ NUEVA VENTA" onPress={startSale} tone="success" /></View>}
    >
      <SystemStatusBanner online={online} pendingCount={pendingCount} onPress={() => navigation.navigate("SystemStatus")} />
      {testMode ? <Card tone="warning"><Text style={styles.copy}><Text style={styles.cardTitle}>Modo pruebas. </Text>Tus comprobantes todavía no tienen validez ante SUNAT. Te avisaremos cuando tu facturación electrónica esté activa.</Text></Card> : null}

      <View style={styles.heroRow}>
        <View style={styles.hero}>
          <Text style={styles.heroLabel}>Ventas de hoy</Text>
          <Text style={styles.heroValue}>{todayTotal !== undefined ? money(todayTotal) : online ? "…" : "—"}</Text>
          <Text style={styles.heroSub}>{insights ? `${insights.today.count} ${insights.today.count === 1 ? "venta" : "ventas"} · ${deltaText(insights.today.total, insights.yesterday)}` : online ? "Cargando…" : "Sin Internet"}</Text>
          {insights ? (
            <View style={styles.bars}>
              {insights.week.series.map((day) => {
                const isToday = day.date === insights.date;
                const dow = new Date(`${day.date}T12:00:00Z`).getUTCDay();
                return (
                  <View key={day.date} style={styles.barCol}>
                    <View style={styles.barTrack}><View style={[styles.bar, isToday && styles.barToday, { height: `${Math.max(4, (day.total / maxBar) * 100)}%` }]} /></View>
                    <Text style={[styles.barLabel, isToday && { color: "#FFFFFF" }]}>{DAY_LETTERS[dow]}</Text>
                  </View>
                );
              })}
            </View>
          ) : null}
          {insights ? <Text style={styles.heroSub}>Últimos 7 días: {money(insights.week.total)}</Text> : null}
        </View>

        <View style={styles.sideCards}>
          <Pressable accessibilityRole="button" onPress={() => navigation.navigate("PorCobrar")} style={styles.miniCard}>
            <Text style={styles.metricLabel}>Por cobrar (fiados)</Text>
            <Text style={styles.metricValue}>{insights ? money(insights.receivables.total) : "—"}</Text>
            <Text style={styles.metricHelper}>{insights?.receivables.customers ? `${insights.receivables.customers} cliente(s) · más antigua ${insights.receivables.oldestDays} d` : "Nadie te debe"}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => navigation.navigate("Productos")} style={[styles.miniCard, insights?.lowStock.length ? styles.miniWarn : undefined]}>
            <Text style={styles.metricLabel}>Stock bajo</Text>
            <Text style={styles.metricValue}>{insights ? String(insights.lowStock.length) : "—"}</Text>
            <Text style={styles.metricHelper} numberOfLines={2}>{insights?.lowStock.length ? insights.lowStock.slice(0, 3).map((p) => `${p.name} (${p.stockQty})`).join(" · ") : "Todo con stock suficiente"}</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.twoColumns}>
        <View style={styles.placeholderCard}>
          <Text style={styles.cardTitle}>Lo que más vendes (30 días)</Text>
          {insights?.topProducts.length ? insights.topProducts.map((p, index) => (
            <View key={p.name} style={styles.topRow}><Text style={styles.topRank}>{index + 1}</Text><Text style={[styles.copy, { flex: 1 }]} numberOfLines={1}>{p.name}</Text><Text style={styles.topValue}>{money(p.revenue)}</Text></View>
          )) : <Text style={styles.copy}>Aún no hay ventas suficientes para mostrar.</Text>}
          {insights?.peakHour !== null && insights?.peakHour !== undefined ? <Text style={styles.metricHelper}>Tu hora más fuerte: {insights.peakHour}:00 – {insights.peakHour + 1}:00</Text> : null}
        </View>
        <View style={styles.placeholderCard}>
          <Text style={styles.cardTitle}>Atajos</Text>
          <Pressable accessibilityRole="button" onPress={shareSummary} disabled={!insights} style={styles.shortcut}><Text style={styles.shortcutText}>Compartir resumen del día por WhatsApp</Text><Text style={styles.chevron}>›</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={() => navigation.navigate("CashClose")} style={styles.shortcut}><Text style={styles.shortcutText}>Cierre de caja{today ? ` · efectivo esperado ${money(today.expectedCash)}` : ""}</Text><Text style={styles.chevron}>›</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={() => navigation.navigate("Guides")} style={styles.shortcut}><Text style={styles.shortcutText}>Guías de remisión</Text><Text style={styles.chevron}>›</Text></Pressable>
          {today?.pending.count ? <Text style={styles.bullet}>• {today.pending.count} comprobante(s) esperando confirmación de SUNAT</Text> : null}
          {today?.rejected.count ? <Text style={[styles.bullet, { color: theme.colors.danger }]}>• {today.rejected.count} comprobante(s) rechazado(s): revísalos</Text> : null}
        </View>
      </View>
    </ResponsiveShell>
  );
}

export function HistorialComprobantesScreen({ navigation }: Props<"HistorialComprobantes">) {
  const { queue, history, pendingCount, refreshHistory, online } = useApp();
  useEffect(() => { if (online) void refreshHistory(); }, [online, refreshHistory]);
  const accepted = history.filter((item) => item.status === "ACCEPTED" && !item.voided && item.documentType !== "NOTA_CREDITO").length;
  const errors = queue.filter((item) => item.status === "ERROR" || item.status === "REJECTED").length
    + history.filter((item) => item.status === "REJECTED").length;

  return (
    <ResponsiveShell
      currentRoute="HistorialComprobantes"
      navigation={navigation}
      title="Historial de comprobantes"
      subtitle="Toca un comprobante para verlo, compartirlo o anularlo."
    >
      <View style={styles.metricsGrid}>
        <MetricCard label="Aceptados" value={String(accepted)} helper="Vigentes (sin anulados)" />
        <MetricCard label="Pendientes" value={String(pendingCount)} helper="Cola de sincronización" />
        <MetricCard label="Por revisar" value={String(errors)} helper="Requieren atención" />
      </View>
      <ReceiptList onOpen={(clientTransactionId) => navigation.navigate("ReceiptDetail", { clientTransactionId })} />
    </ResponsiveShell>
  );
}

export function ConfiguracionScreen({ navigation }: Props<"Configuracion">) {
  return (
    <ResponsiveShell
      currentRoute="Configuracion"
      navigation={navigation}
      title="Configuración"
      subtitle="Administración del negocio, facturación electrónica, suscripción y soporte."
    >
      <View style={styles.twoColumns}>
        <ConfigLink title="Clientes" detail="Tus clientes frecuentes y sus datos" onPress={() => navigation.navigate("Customers")} />
        <ConfigLink title="Guías de remisión" detail="Traslado de mercadería: remitente o transportista" onPress={() => navigation.navigate("Guides")} />
        <ConfigLink title="Cierre de caja y reportes" detail="Ventas del día por medio de pago y registro mensual para tu contador" onPress={() => navigation.navigate("CashClose")} />
        <ConfigLink title="Datos de empresa" detail="RUC, razón social, nombre comercial y dirección" onPress={() => navigation.navigate("Business")} />
        <ConfigLink title="Facturación electrónica" detail="Proveedor externo, series, comprobantes habilitados y conexión" onPress={() => navigation.navigate("SystemStatus")} />
        <ConfigLink title="Suscripción SaaS" detail="Plan mensual, estado de pago, renovación y comprobantes de cobro" />
        <ConfigLink title="Usuarios y seguridad" detail="Propietario, cajeros, sesiones y cambio de contraseña" />
        <ConfigLink title="Soporte" detail="Ayuda sencilla y diagnóstico del sistema" onPress={() => navigation.navigate("Support")} />
      </View>
    </ResponsiveShell>
  );
}

function MetricCard({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricHelper}>{helper}</Text>
    </View>
  );
}

function PlaceholderCard({ title, items }: { title: string; items: string[] }) {
  return (
    <View style={styles.placeholderCard}>
      <Text style={styles.cardTitle}>{title}</Text>
      {items.map((item) => <Text key={item} style={styles.bullet}>• {item}</Text>)}
    </View>
  );
}

function ConfigLink({ title, detail, onPress }: { title: string; detail: string; onPress?: () => void }) {
  return (
    <Pressable accessibilityRole="button" disabled={!onPress} onPress={onPress} style={({ pressed }) => [styles.configLink, pressed && onPress && { opacity: 0.8 }]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.copy}>{detail}</Text>
      </View>
      <Text style={styles.chevron}>{onPress ? "›" : "Próximamente"}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  heroRow: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  hero: { flexGrow: 2, flexBasis: 340, minWidth: 280, backgroundColor: theme.colors.ink, borderRadius: 22, padding: 20, gap: 4 },
  heroLabel: { color: "#A9AED3", fontWeight: "800" },
  heroValue: { color: "#FFFFFF", fontWeight: "900", fontSize: 40, letterSpacing: -1 },
  heroSub: { color: "#C9CCE8", fontSize: 13 },
  bars: { flexDirection: "row", gap: 8, height: 90, alignItems: "flex-end", marginVertical: 12 },
  barCol: { flex: 1, height: "100%", alignItems: "center", gap: 4 },
  barTrack: { flex: 1, width: "100%", justifyContent: "flex-end" },
  bar: { width: "100%", backgroundColor: "#4B52A0", borderRadius: 6 },
  barToday: { backgroundColor: theme.colors.mint },
  barLabel: { color: "#8D93C4", fontSize: 11, fontWeight: "800" },
  sideCards: { flexGrow: 1, flexBasis: 240, gap: 12 },
  miniCard: { flex: 1, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 18, padding: 16, justifyContent: "center" },
  miniWarn: { backgroundColor: theme.colors.warningSoft, borderColor: "#F3D28A" },
  topRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  topRank: { width: 22, height: 22, borderRadius: 11, backgroundColor: theme.colors.primarySoft, color: theme.colors.primary, textAlign: "center", fontWeight: "900", fontSize: 12, lineHeight: 22 },
  topValue: { color: theme.colors.text, fontWeight: "800" },
  shortcut: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border },
  shortcutText: { color: theme.colors.text, fontWeight: "700", flex: 1 },
  metricsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  metricCard: { minWidth: 190, flexGrow: 1, flexBasis: 0, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 18, padding: 16 },
  metricLabel: { color: theme.colors.muted, fontWeight: "800" },
  metricValue: { color: theme.colors.text, fontWeight: "900", fontSize: 27, marginTop: 8 },
  metricHelper: { color: theme.colors.muted, fontSize: 12, marginTop: 4 },
  twoColumns: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  placeholderCard: { minWidth: 280, flexGrow: 1, flexBasis: 0, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 18, padding: 18, gap: 9 },
  cardTitle: { color: theme.colors.text, fontWeight: "900", fontSize: 16 },
  copy: { color: theme.colors.muted, lineHeight: 21 },
  bullet: { color: theme.colors.muted, lineHeight: 21 },
  configLink: { minWidth: 280, flexGrow: 1, flexBasis: 0, minHeight: 100, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 18, padding: 18, flexDirection: "row", alignItems: "center", gap: 12 },
  chevron: { color: theme.colors.primary, fontWeight: "900" }
});
