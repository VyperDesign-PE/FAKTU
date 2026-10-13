import { useEffect, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/types";
import { ResponsiveShell } from "../../components/ResponsiveShell";
import { Badge, Card, Panel, PrimaryButton, SectionTitle } from "../../components/Ui";
import { Icon, type IconName } from "../../components/Icon";
import { SystemStatusBanner } from "../../components/SystemStatusBanner";
import { useApp } from "../../context/AppContext";
import { ReceiptList } from "../management/ManagementScreens";
import { getBillingSettings, getDailyClose, getInsights, type BillingSettings, type DailyClose, type Insights } from "../../services/api";
import { cardShadow, theme } from "../../theme";
import { BrandBackdrop } from "../../components/BrandBackdrop";
import { BrandMark } from "../../components/Brand";
import { attentionCount, awaitingSendCount, effectiveSales } from "../../domain/receiptMetrics";

type Props<Name extends keyof RootStackParamList> = NativeStackScreenProps<RootStackParamList, Name>;

const money = (value: number) => `S/ ${value.toFixed(2)}`;
const WEEKDAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

function deltaText(today: number, before: number) {
  if (before <= 0) return today > 0 ? "Primer día con ventas para comparar" : "Aún sin ventas";
  const pct = Math.round(((today - before) / before) * 100);
  return pct === 0 ? "Igual que ayer" : `${Math.abs(pct)}% ${pct > 0 ? "más" : "menos"} que ayer`;
}

type Accent = "blue" | "violet" | "teal" | "warning";
const ACCENTS: Record<Accent, { fg: string; bg: string }> = {
  blue: { fg: theme.colors.primaryText, bg: theme.colors.primarySoft },
  violet: { fg: theme.colors.accentViolet, bg: theme.colors.accentVioletSoft },
  teal: { fg: theme.colors.accentTeal, bg: theme.colors.accentTealSoft },
  warning: { fg: theme.colors.warning, bg: theme.colors.warningSoft }
};

function greeting(now = new Date()) {
  const hour = now.getHours();
  return hour < 12 ? "Buenos días" : hour < 19 ? "Buenas tardes" : "Buenas noches";
}

function KpiCard({ label, value, helper, icon, onPress, tone = "default", accent = "blue" }: { label: string; value: string; helper: string; icon: IconName; onPress?: () => void; tone?: "default" | "warning"; accent?: Accent }) {
  const colors = ACCENTS[tone === "warning" ? "warning" : accent];
  const body = (
    <View style={[styles.kpi, cardShadow, tone === "warning" && styles.kpiWarning]}>
      <View style={[styles.kpiStripe, { backgroundColor: colors.fg }]} />
      <View style={styles.kpiTop}>
        <View style={[styles.kpiIcon, { backgroundColor: colors.bg }]}>
          <Icon name={icon} size={20} color={colors.fg} />
        </View>
        <Text style={styles.kpiLabel}>{label}</Text>
        {onPress ? <Icon name="chevron" size={16} color={theme.colors.muted} /> : null}
      </View>
      <Text style={styles.kpiValue}>{value}</Text>
      <Text style={styles.kpiHelper} numberOfLines={2}>{helper}</Text>
    </View>
  );
  return onPress ? <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value}`} onPress={onPress} style={styles.kpiWrap}>{body}</Pressable> : <View style={styles.kpiWrap}>{body}</View>;
}

export function DashboardScreen({ navigation }: Props<"Dashboard">) {
  const { online, pendingCount, profile, queue, history, resetDraft } = useApp();
  const [today, setToday] = useState<DailyClose>();
  const [insights, setInsights] = useState<Insights>();
  const [billing, setBilling] = useState<BillingSettings>();
  useEffect(() => { if (online) getBillingSettings().then(setBilling).catch(() => undefined); }, [online]);
  const practiceMode = billing?.providerCode === "mock" || (billing ? !billing.credentialConfigured : false);
  const business = profile.tradeName ?? profile.businessName ?? "tu negocio";

  // Métricas reales desde el servidor (todas las cajas del negocio).
  useEffect(() => {
    if (!online) return;
    getDailyClose().then(setToday).catch(() => undefined);
    getInsights().then(setInsights).catch(() => undefined);
  }, [online, queue.length, history.length]);

  const todayTotal = insights?.today.total ?? today?.netTotal;
  const maxBar = Math.max(1, ...(insights?.week.series.map((day) => day.total) ?? [1]));
  const placeholder = online ? "…" : "—";
  const dateLabel = new Date().toLocaleDateString("es-PE", { weekday: "long", day: "numeric", month: "long" });

  function startSale() {
    resetDraft();
    navigation.navigate("POSVenta");
  }

  function shareSummary() {
    if (!insights) return;
    const lines = [
      `Resumen de ${business} — ${insights.date}`,
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
      title="Resumen"
      hideHeader
    >
      <BrandBackdrop style={styles.hero}>
        <View style={styles.heroMark} aria-hidden><BrandMark size={150} /></View>
        <Text style={styles.heroDate}>{dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1)}</Text>
        <Text accessibilityRole="header" style={styles.heroTitle}>{greeting()}, {business}</Text>
        <Text style={styles.heroText}>
          {insights
            ? insights.today.count
              ? `Hoy llevas ${money(insights.today.total)} en ${insights.today.count} ${insights.today.count === 1 ? "venta" : "ventas"}. ${deltaText(insights.today.total, insights.yesterday)}.`
              : "Todavía no hay ventas hoy. Cuando registres la primera, la verás aquí."
            : online ? "Cargando el resumen de tu negocio…" : "Sin Internet: puedes seguir vendiendo; el resumen se actualiza al volver la conexión."}
        </Text>
        <View style={styles.heroActions}>
          <Pressable accessibilityRole="button" onPress={startSale} style={({ hovered }: { pressed: boolean; hovered?: boolean }) => [styles.heroPrimary, hovered && { opacity: 0.92 }]}>
            <Icon name="plus" size={18} color={theme.colors.ink} />
            <Text style={styles.heroPrimaryText}>Nueva venta</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => navigation.navigate("HistorialComprobantes")} style={({ hovered }: { pressed: boolean; hovered?: boolean }) => [styles.heroSecondary, hovered && { backgroundColor: "rgba(255, 255, 255, 0.12)" }]}>
            <Icon name="receipt" size={18} color="#FFFFFF" />
            <Text style={styles.heroSecondaryText}>Ver historial</Text>
          </Pressable>
        </View>
      </BrandBackdrop>

      <SystemStatusBanner online={online} pendingCount={pendingCount} onPress={() => navigation.navigate("SystemStatus")} />
      {practiceMode ? (
        <View style={styles.notice} accessibilityRole="alert">
          <Icon name="alert" size={20} color={theme.colors.warning} />
          <Text style={styles.noticeText}><Text style={styles.noticeTitle}>Modo práctica. </Text>Los comprobantes que emitas ahora son de prueba y no tienen validez ante SUNAT. Te avisaremos cuando tu facturación electrónica esté activa.</Text>
        </View>
      ) : null}

      <View style={styles.kpiRow}>
        <KpiCard label="Ventas de hoy" icon="trend" value={todayTotal !== undefined ? money(todayTotal) : placeholder} helper={insights ? `${insights.today.count} ${insights.today.count === 1 ? "venta" : "ventas"} · ${deltaText(insights.today.total, insights.yesterday)}` : online ? "Cargando…" : "Sin Internet"} />
        <KpiCard label="Últimos 7 días" icon="receipt" accent="violet" value={insights ? money(insights.week.total) : placeholder} helper={insights ? `${insights.week.series.reduce((sum, day) => sum + day.count, 0)} comprobantes` : " "} />
        <KpiCard label="Por cobrar (fiados)" icon="wallet" accent="teal" onPress={() => navigation.navigate("PorCobrar")} value={insights ? money(insights.receivables.total) : placeholder} helper={insights?.receivables.customers ? `${insights.receivables.customers} cliente(s) · la más antigua, ${insights.receivables.oldestDays} d` : "Nadie te debe"} />
        <KpiCard label="Stock bajo" icon="box" tone={insights?.lowStock.length ? "warning" : "default"} onPress={() => navigation.navigate("Productos")} value={insights ? String(insights.lowStock.length) : placeholder} helper={insights?.lowStock.length ? insights.lowStock.slice(0, 3).map((p) => `${p.name} (${p.stockQty})`).join(" · ") : "Todo con stock suficiente"} />
      </View>

      <View style={styles.twoColumns}>
        <View style={styles.column}>
          <Panel title="Ventas de los últimos 7 días">
            {insights ? (
              <>
                <View style={styles.bars}>
                  {insights.week.series.map((day) => {
                    const isToday = day.date === insights.date;
                    const dow = new Date(`${day.date}T12:00:00Z`).getUTCDay();
                    return (
                      <View key={day.date} style={styles.barCol} accessible accessibilityLabel={`${WEEKDAYS[dow]}: ${money(day.total)}`}>
                        <Text style={styles.barValue}>{day.total > 0 ? Math.round(day.total) : ""}</Text>
                        <View style={styles.barTrack}><View style={[styles.bar, isToday && styles.barToday, { height: `${Math.max(3, (day.total / maxBar) * 100)}%` }]} /></View>
                        <Text style={[styles.barLabel, isToday && { color: theme.colors.primaryText, fontWeight: "700" }]}>{WEEKDAYS[dow]}</Text>
                      </View>
                    );
                  })}
                </View>
                <Text style={styles.muted}>Importes en soles. El día de hoy aparece resaltado.</Text>
              </>
            ) : <Text style={styles.muted}>{online ? "Cargando…" : "Sin Internet: conéctate para ver las ventas de la semana."}</Text>}
          </Panel>
        </View>

        <View style={styles.column}>
          <Panel title="Lo que más vendes (30 días)" flush>
            {insights?.topProducts.length ? (
              <View>
                <View style={[styles.tableRow, styles.tableHead]}><Text style={[styles.th, { width: 28 }]}>#</Text><Text style={[styles.th, { flex: 1 }]}>Producto</Text><Text style={[styles.th, { textAlign: "right" }]}>Importe</Text></View>
                {insights.topProducts.map((p, index) => (
                  <View key={p.name} style={styles.tableRow}><Text style={[styles.td, { width: 28, color: theme.colors.muted }]}>{index + 1}</Text><Text style={[styles.td, { flex: 1 }]} numberOfLines={1}>{p.name}</Text><Text style={[styles.td, styles.amount]}>{money(p.revenue)}</Text></View>
                ))}
              </View>
            ) : <View style={{ padding: 18 }}><Text style={styles.muted}>Aún no hay ventas suficientes para mostrar.</Text></View>}
            {insights?.peakHour !== null && insights?.peakHour !== undefined ? <View style={styles.tableFoot}><Text style={styles.muted}>Tu hora más fuerte: {insights.peakHour}:00 – {insights.peakHour + 1}:00</Text></View> : null}
          </Panel>
        </View>
      </View>

      <Panel title="Accesos rápidos" flush>
        <ShortcutRow icon="wallet" title="Cierre de caja" detail={today ? `Efectivo esperado ${money(today.expectedCash)}` : "Ventas del día por medio de pago"} onPress={() => navigation.navigate("CashClose")} />
        <ShortcutRow icon="truck" title="Guías de remisión" detail="Traslado de mercadería" onPress={() => navigation.navigate("Guides")} />
        <ShortcutRow icon="file" title="Compartir resumen del día por WhatsApp" detail={insights ? "Abre WhatsApp con el resumen listo" : "Disponible cuando cargue el resumen"} onPress={shareSummary} disabled={!insights} last />
        {today?.pending.count || today?.rejected.count ? (
          <View style={styles.tableFoot}>
            {today?.pending.count ? <Badge tone="warning" label={`${today.pending.count} esperando confirmación de SUNAT`} /> : null}
            {today?.rejected.count ? <Badge tone="danger" label={`${today.rejected.count} rechazado(s): revísalos`} /> : null}
          </View>
        ) : null}
      </Panel>
    </ResponsiveShell>
  );
}

function ShortcutRow({ icon, title, detail, onPress, disabled, last }: { icon: IconName; title: string; detail: string; onPress: () => void; disabled?: boolean; last?: boolean }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled} style={({ hovered }: { pressed: boolean; hovered?: boolean }) => [styles.shortcut, !last && styles.shortcutDivider, hovered && { backgroundColor: theme.colors.hover }, disabled && { opacity: 0.5 }]}>
      <View style={styles.kpiIcon}><Icon name={icon} size={18} color={theme.colors.primaryText} /></View>
      <View style={{ flex: 1 }}><Text style={styles.shortcutTitle}>{title}</Text><Text style={styles.muted}>{detail}</Text></View>
      <Icon name="chevron" size={18} color={theme.colors.muted} />
    </Pressable>
  );
}

export function HistorialComprobantesScreen({ navigation }: Props<"HistorialComprobantes">) {
  const { queue, history, refreshHistory, online } = useApp();
  useEffect(() => { if (online) void refreshHistory(); }, [online, refreshHistory]);
  const accepted = effectiveSales(history).length;
  const errors = attentionCount(queue, history);

  return (
    <ResponsiveShell
      currentRoute="HistorialComprobantes"
      navigation={navigation}
      title="Historial de comprobantes"
      subtitle="Toca un comprobante para verlo, compartirlo o anularlo."
    >
      <View style={styles.metricsGrid}>
        <MetricCard label="Aceptados" value={String(accepted)} helper="Vigentes (sin anulados)" />
        <MetricCard label="Pendientes" value={String(awaitingSendCount(queue))} helper="Guardados, por enviar" />
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
      subtitle="Productos, clientes, facturación, seguridad y soporte."
    >
      <View style={styles.twoColumns}>
        <ConfigLink title="Productos y stock" detail="Tu catálogo, precios y control de stock" onPress={() => navigation.navigate("Productos")} />
        <ConfigLink title="Clientes" detail="Tus clientes frecuentes y sus datos" onPress={() => navigation.navigate("Customers")} />
        <ConfigLink title="Guías de remisión" detail="Traslado de mercadería: remitente o transportista" onPress={() => navigation.navigate("Guides")} />
        <ConfigLink title="Cierre de caja y reportes" detail="Ventas del día por medio de pago y registro mensual para tu contador" onPress={() => navigation.navigate("CashClose")} />
        <ConfigLink title="Datos de empresa" detail="RUC, razón social, nombre comercial y dirección" onPress={() => navigation.navigate("Business")} />
        <ConfigLink title="Facturación electrónica" detail="Estado de la conexión, comprobantes pendientes y consulta RUC" onPress={() => navigation.navigate("SystemStatus")} />
        <ConfigLink title="Proveedor y ambiente" detail="Elegir proveedor de facturación, probar la conexión y ver si estás en modo práctica" onPress={() => navigation.navigate("BillingSettings")} />
        <ConfigLink title="Suscripción SaaS" detail="Plan mensual, estado de pago, renovación y comprobantes de cobro" />
        <ConfigLink title="Seguridad" detail="Verificación en dos pasos y registro de actividad de tu negocio" onPress={() => navigation.navigate("Seguridad")} />
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
  cta: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44, paddingHorizontal: 18, borderRadius: 10, backgroundColor: theme.colors.primary },
  ctaText: { color: "#FFFFFF", fontWeight: "600", fontSize: 14 },
  notice: { flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 14, borderRadius: 10, borderWidth: 1, backgroundColor: theme.colors.warningSoft, borderColor: theme.colors.warningBorder },
  noticeText: { flex: 1, color: theme.colors.text, lineHeight: 20, fontSize: 14 },
  noticeTitle: { fontWeight: "700" },
  kpiRow: { flexDirection: "row", flexWrap: "wrap", gap: 16 },
  kpiWrap: { flexGrow: 1, flexBasis: 160, minWidth: 150 },
  kpi: { backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, padding: 18, paddingLeft: 21, gap: 8, minHeight: 140, overflow: "hidden" },
  kpiWarning: { borderColor: theme.colors.warningBorder },
  kpiTop: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10 },
  kpiStripe: { position: "absolute", left: 0, top: 0, bottom: 0, width: 3 },
  hero: { borderRadius: 16, padding: 28, gap: 8, minHeight: 190, justifyContent: "center" },
  heroMark: { position: "absolute", right: 28, top: 20, opacity: 0.1, transform: [{ rotate: "-8deg" }] },
  heroDate: { color: "#A9C2F2", fontSize: 13, fontWeight: "600", letterSpacing: 0.3 },
  heroTitle: { color: "#FFFFFF", fontSize: 28, fontWeight: "700", letterSpacing: -0.5, maxWidth: 720 },
  heroText: { color: "#D5DEF0", fontSize: 15, lineHeight: 22, maxWidth: 640 },
  heroActions: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 10 },
  heroPrimary: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44, paddingHorizontal: 18, borderRadius: 10, backgroundColor: "#FFFFFF" },
  heroPrimaryText: { color: theme.colors.ink, fontWeight: "600", fontSize: 14 },
  heroSecondary: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44, paddingHorizontal: 18, borderRadius: 10, borderWidth: 1, borderColor: "rgba(255, 255, 255, 0.35)" },
  heroSecondaryText: { color: "#FFFFFF", fontWeight: "600", fontSize: 14 },
  kpiLabel: { flexGrow: 1, flexShrink: 0, flexBasis: 110, color: theme.colors.muted, fontWeight: "600", fontSize: 13 },
  kpiIcon: { width: 40, height: 40, borderRadius: 10, backgroundColor: theme.colors.primarySoft, alignItems: "center", justifyContent: "center" },
  kpiValue: { color: theme.colors.text, fontWeight: "700", fontSize: 26, letterSpacing: -0.3, fontVariant: ["tabular-nums"] },
  kpiHelper: { color: theme.colors.muted, fontSize: 13, lineHeight: 18 },
  twoColumns: { flexDirection: "row", flexWrap: "wrap", gap: 16 },
  column: { flexGrow: 1, flexBasis: 360, minWidth: 280 },
  bars: { flexDirection: "row", gap: 10, height: 170, alignItems: "flex-end" },
  barCol: { flex: 1, height: "100%", alignItems: "center", gap: 6 },
  barValue: { color: theme.colors.muted, fontSize: 11, height: 14, fontVariant: ["tabular-nums"] },
  barTrack: { flex: 1, width: "100%", justifyContent: "flex-end" },
  bar: { width: "100%", backgroundColor: theme.colors.infoBorder, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  barToday: { backgroundColor: theme.colors.primary },
  barLabel: { color: theme.colors.muted, fontSize: 12, fontWeight: "500" },
  muted: { color: theme.colors.muted, fontSize: 13, lineHeight: 18 },
  tableRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 13, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  tableHead: { backgroundColor: theme.colors.tableHead, paddingVertical: 9 },
  th: { color: theme.colors.muted, fontSize: 12, fontWeight: "600" },
  td: { color: theme.colors.text, fontSize: 14 },
  amount: { textAlign: "right", fontWeight: "600", fontVariant: ["tabular-nums"] },
  tableFoot: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingVertical: 12, paddingHorizontal: 18 },
  shortcut: { flexDirection: "row", alignItems: "center", gap: 14, minHeight: 64, paddingVertical: 12, paddingHorizontal: 18 },
  shortcutDivider: { borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  shortcutTitle: { color: theme.colors.text, fontWeight: "600", fontSize: 14 },
  metricsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  metricCard: { minWidth: 190, flexGrow: 1, flexBasis: 0, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, padding: 16 },
  metricLabel: { color: theme.colors.muted, fontWeight: "600" },
  metricValue: { color: theme.colors.text, fontWeight: "700", fontSize: 27, marginTop: 8 },
  metricHelper: { color: theme.colors.muted, fontSize: 12, marginTop: 4 },
  placeholderCard: { minWidth: 280, flexGrow: 1, flexBasis: 0, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, padding: 18, gap: 9 },
  cardTitle: { color: theme.colors.text, fontWeight: "700", fontSize: 16 },
  copy: { color: theme.colors.muted, lineHeight: 21 },
  bullet: { color: theme.colors.muted, lineHeight: 21 },
  configLink: { minWidth: 280, flexGrow: 1, flexBasis: 0, minHeight: 100, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, padding: 18, flexDirection: "row", alignItems: "center", gap: 12 },
  chevron: { color: theme.colors.primaryText, fontWeight: "700" }
});
