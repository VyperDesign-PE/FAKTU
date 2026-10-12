import { Pressable, StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/types";
import { ResponsiveShell } from "../../components/ResponsiveShell";
import { Card, PrimaryButton, SectionTitle } from "../../components/Ui";
import { SystemStatusBanner } from "../../components/SystemStatusBanner";
import { useApp } from "../../context/AppContext";
import { theme } from "../../theme";

type Props<Name extends keyof RootStackParamList> = NativeStackScreenProps<RootStackParamList, Name>;

export function DashboardScreen({ navigation }: Props<"Dashboard">) {
  const { online, pendingCount, profile, queue, resetDraft } = useApp();
  const accepted = queue.filter((r) => r.status === "ACCEPTED");
  const todayTotal = accepted.reduce((sum, r) => sum + r.total, 0);

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

      <View style={styles.metricsGrid}>
        <MetricCard label="Ventas registradas" value={String(queue.length)} helper="Hoy / dispositivo" />
        <MetricCard label="Total aceptado" value={`S/ ${todayTotal.toFixed(2)}`} helper="Comprobantes aceptados" />
        <MetricCard label="Pendientes" value={String(pendingCount)} helper="Se sincronizan automáticamente" />
      </View>

      <Card>
        <SectionTitle>Acción principal</SectionTitle>
        <Text style={styles.copy}>El propietario debe poder llegar al POS en un toque y emitir sin navegar por menús complejos.</Text>
        <PrimaryButton label="＋ NUEVA VENTA" onPress={startSale} />
      </Card>

      <View style={styles.twoColumns}>
        <PlaceholderCard title="Métricas del día" items={["Boletas vs. facturas", "Ticket promedio", "Ventas por hora", "Productos más vendidos"]} />
        <PlaceholderCard title="Alertas útiles" items={["Comprobantes con observación", "Suscripción por vencer", "Conexión PSE/SUNAT", `Negocio: ${profile.tradeName ?? profile.businessName ?? "por configurar"}`]} />
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
      <View style={styles.twoColumns}>
        <PlaceholderCard title="Buscador y catálogo" items={["Buscar por nombre o código", "Favoritos", "Categorías rápidas", "Venta manual / servicio"]} />
        <PlaceholderCard title="Carrito" items={["Cantidad y precio", "Descuento permitido", "Cliente opcional", "Boleta o factura", "Total a pagar"]} />
      </View>
      <Card tone={online ? "success" : "warning"}>
        <Text style={styles.cardTitle}>{online ? "Listo para emitir" : "Modo sin Internet"}</Text>
        <Text style={styles.copy}>{online ? "La venta puede enviarse al proveedor de facturación." : "La venta se guardará y generará una constancia temporal hasta recuperar la conexión."}</Text>
        <PrimaryButton label="ABRIR POS ACTUAL" onPress={openPos} tone={online ? "success" : "primary"} />
      </Card>
    </ResponsiveShell>
  );
}

export function HistorialComprobantesScreen({ navigation }: Props<"HistorialComprobantes">) {
  const { queue, pendingCount } = useApp();
  const accepted = queue.filter((item) => item.status === "ACCEPTED").length;
  const errors = queue.filter((item) => item.status === "ERROR").length;

  return (
    <ResponsiveShell
      currentRoute="HistorialComprobantes"
      navigation={navigation}
      title="Historial de comprobantes"
      subtitle="Consulta, filtra, reenvía y revisa el estado de cada documento electrónico."
    >
      <View style={styles.metricsGrid}>
        <MetricCard label="Aceptados" value={String(accepted)} helper="Proveedor / SUNAT" />
        <MetricCard label="Pendientes" value={String(pendingCount)} helper="Cola de sincronización" />
        <MetricCard label="Por revisar" value={String(errors)} helper="Requieren atención" />
      </View>
      <PlaceholderCard title="Filtros de la vista" items={["Fecha desde / hasta", "Boleta / factura", "DNI / RUC / razón social", "Serie y correlativo", "Aceptado / pendiente / observado"]} />
      <PrimaryButton label="VER HISTORIAL IMPLEMENTADO" onPress={() => navigation.navigate("ReceiptHistory")} />
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
