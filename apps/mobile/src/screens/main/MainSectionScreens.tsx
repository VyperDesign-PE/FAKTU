import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/types";
import { ResponsiveShell } from "../../components/ResponsiveShell";
import { Card, PrimaryButton, SectionTitle } from "../../components/Ui";
import { SystemStatusBanner } from "../../components/SystemStatusBanner";
import { useApp } from "../../context/AppContext";
import { PAYMENT_METHODS } from "../../domain/types";
import { ReceiptList } from "../management/ManagementScreens";
import { getBillingSettings, getDailyClose, type BillingSettings, type DailyClose } from "../../services/api";
import { theme } from "../../theme";

type Props<Name extends keyof RootStackParamList> = NativeStackScreenProps<RootStackParamList, Name>;

export function DashboardScreen({ navigation }: Props<"Dashboard">) {
  const { online, pendingCount, profile, queue, history, resetDraft } = useApp();
  const [today, setToday] = useState<DailyClose>();
  const [billing, setBilling] = useState<BillingSettings>();
  useEffect(() => { if (online) getBillingSettings().then(setBilling).catch(() => undefined); }, [online]);
  const testMode = billing?.providerCode === "mock" || (billing ? !billing.credentialConfigured : false);

  // Métricas reales del día desde el servidor (todas las cajas del negocio).
  useEffect(() => {
    if (!online) return;
    getDailyClose().then(setToday).catch(() => undefined);
  }, [online, queue.length, history.length]);

  const topMethod = today?.paymentMethods.slice().sort((a, b) => b.net - a.net)[0];
  const averageTicket = today && today.sales.count ? today.sales.total / today.sales.count : 0;

  function startSale() {
    resetDraft();
    navigation.navigate(online ? "NewSale" : "OfflineSale");
  }

  return (
    <ResponsiveShell
      currentRoute="Dashboard"
      navigation={navigation}
      title="Dashboard"
      subtitle="Vista resumida del negocio: ventas, comprobantes pendientes y estado operativo."
    >
      <SystemStatusBanner online={online} pendingCount={pendingCount} onPress={() => navigation.navigate("SystemStatus")} />
      {testMode ? <Card tone="warning"><Text style={styles.copy}><Text style={styles.cardTitle}>Modo pruebas. </Text>Tus comprobantes todavía no tienen validez ante SUNAT. Te avisaremos cuando tu facturación electrónica esté activa.</Text></Card> : null}

      <PrimaryButton label="＋ NUEVA VENTA" onPress={startSale} />

      <View style={styles.metricsGrid}>
        <MetricCard label="Ventas de hoy" value={today ? `S/ ${today.netTotal.toFixed(2)}` : "—"} helper={today ? `${today.sales.count} ventas · neto de anulaciones` : online ? "Cargando..." : "Sin Internet"} />
        <MetricCard label="Ticket promedio" value={today ? `S/ ${averageTicket.toFixed(2)}` : "—"} helper={topMethod ? `Más usado: ${PAYMENT_METHODS.find((m) => m.value === topMethod.method)?.label ?? topMethod.method}` : "Por venta"} />
        <MetricCard label="Pendientes" value={String(pendingCount)} helper="Se sincronizan automáticamente" />
      </View>


      <View style={styles.twoColumns}>
        <ConfigLink title="Cierre de caja" detail={today ? `Efectivo esperado: S/ ${today.expectedCash.toFixed(2)} · Registro para tu contador` : "Ventas por medio de pago y registro para tu contador"} onPress={() => navigation.navigate("CashClose")} />
        <PlaceholderCard title="Alertas útiles" items={[
          ...(today?.pending.count ? [`${today.pending.count} comprobante(s) esperando confirmación de SUNAT`] : []),
          ...(today?.rejected.count ? [`${today.rejected.count} comprobante(s) rechazado(s): revísalos`] : []),
          ...(!today?.pending.count && !today?.rejected.count ? ["Sin alertas: todo en orden"] : []),
          `Negocio: ${profile.tradeName ?? profile.businessName ?? "por configurar"}`
        ]} />
      </View>
    </ResponsiveShell>
  );
}

export function POSVentaScreen({ navigation }: Props<"POSVenta">) {
  const { online, resetDraft } = useApp();

  function openPos() {
    resetDraft();
    navigation.navigate(online ? "NewSale" : "OfflineSale");
  }

  return (
    <ResponsiveShell
      currentRoute="POSVenta"
      navigation={navigation}
      title="POS / Venta"
      subtitle="Punto de venta optimizado para teclado, mouse, pantalla táctil y celular."
    >
      <Card tone={online ? "success" : "warning"}>
        <Text style={styles.cardTitle}>{online ? "Listo para emitir" : "Modo sin Internet"}</Text>
        <Text style={styles.copy}>{online ? "La venta puede enviarse al proveedor de facturación." : "La venta se guardará y generará una constancia temporal hasta recuperar la conexión."}</Text>
        <PrimaryButton label="＋ NUEVA VENTA" onPress={openPos} tone={online ? "success" : "primary"} />
      </Card>
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
