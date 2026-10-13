import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { SystemStatusBanner } from "../components/SystemStatusBanner";
import { useApp } from "../context/AppContext";
import { theme } from "../theme";
import { effectiveSales, todaySales } from "../domain/receiptMetrics";

type Props = NativeStackScreenProps<RootStackParamList, "Home">;

export function HomeScreen({ navigation }: Props) {
  const { online, pendingCount, profile, queue, history, resetDraft } = useApp();
  const now = new Date();
  const today = todaySales(history, now);

  function startSale() {
    resetDraft();
    navigation.navigate("POSVenta");
  }

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.header}><Text style={styles.business}>{profile.tradeName ?? profile.businessName ?? "MI NEGOCIO"}</Text><Text style={styles.ruc}>RUC {profile.ruc ?? "-"}</Text></View>
      <SystemStatusBanner online={online} pendingCount={pendingCount} onPress={() => navigation.navigate("SystemStatus")} />
      <Pressable style={styles.saleButton} onPress={startSale}><Text style={styles.salePlus}>＋</Text><Text style={styles.saleTitle}>NUEVA VENTA</Text><Text style={styles.saleSubtitle}>Emite boleta o factura</Text></Pressable>
      <View style={styles.grid}>
        <MenuCard title="PRODUCTOS / SERVICIOS" subtitle="Mi catálogo" onPress={() => navigation.navigate("Catalog")} />
        <MenuCard title="COMPROBANTES" subtitle={pendingCount > 0 ? `${pendingCount} pendientes` : "Mis ventas"} onPress={() => navigation.navigate("ReceiptHistory")} />
        <MenuCard title="CLIENTES" subtitle="Datos del cliente" onPress={() => navigation.navigate("Customers")} />
        <MenuCard title="MÁS" subtitle="Negocio y ayuda" onPress={() => navigation.navigate("Business")} />
      </View>
      <View style={styles.summary}><Text style={styles.summaryTitle}>Resumen de hoy</Text><Text style={styles.muted}>Ventas vigentes de hoy (sin anuladas ni notas)</Text><Text style={styles.total}>S/ {today.total.toFixed(2)}</Text><View style={styles.summaryRow}><Metric value={String(today.count)} label="Ventas hoy" /><Metric value={String(effectiveSales(history).length)} label="Aceptados" /><Metric value={String(pendingCount)} label="Pendientes" /></View></View>
    </ScrollView>
  );
}

function MenuCard({ title, subtitle, onPress }: { title: string; subtitle: string; onPress: () => void }) { return <Pressable style={styles.card} onPress={onPress}><Text style={styles.cardTitle}>{title}</Text><Text style={styles.cardSub}>{subtitle}</Text></Pressable>; }
function Metric({ value, label }: { value: string; label: string }) { return <View style={{ flex: 1, alignItems: "center" }}><Text style={styles.metricValue}>{value}</Text><Text style={styles.muted}>{label}</Text></View>; }

const styles = StyleSheet.create({
  page: { padding: 18, gap: 16, backgroundColor: theme.colors.background, flexGrow: 1 }, header: { paddingTop: 10, paddingBottom: 2 }, business: { fontSize: 18, fontWeight: "900", color: theme.colors.text }, ruc: { color: theme.colors.muted, marginTop: 2 },
  saleButton: { backgroundColor: theme.colors.primary, padding: 24, borderRadius: 20, alignItems: "center" }, salePlus: { color: "white", fontSize: 28, fontWeight: "800" }, saleTitle: { color: "white", fontWeight: "900", fontSize: 20 }, saleSubtitle: { color: theme.colors.primarySoft, marginTop: 4 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 }, card: { width: "48%", minHeight: 105, backgroundColor: theme.colors.surface, borderRadius: 18, padding: 16, justifyContent: "center", borderWidth: 1, borderColor: theme.colors.border }, cardTitle: { fontWeight: "900", color: theme.colors.text, lineHeight: 20 }, cardSub: { color: theme.colors.muted, marginTop: 5 },
  summary: { backgroundColor: theme.colors.surface, borderRadius: 18, padding: 18, borderWidth: 1, borderColor: theme.colors.border }, summaryTitle: { fontSize: 17, fontWeight: "900", color: theme.colors.text, marginBottom: 14 }, muted: { color: theme.colors.muted, fontSize: 12 }, total: { color: theme.colors.success, fontSize: 30, fontWeight: "900", marginVertical: 4 }, summaryRow: { flexDirection: "row", marginTop: 18, paddingTop: 15, borderTopWidth: 1, borderTopColor: theme.colors.mutedSoft }, metricValue: { fontWeight: "900", color: theme.colors.text, marginBottom: 3 }
});
