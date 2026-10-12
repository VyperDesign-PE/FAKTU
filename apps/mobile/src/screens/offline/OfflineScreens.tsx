import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/types";
import { Screen } from "../../components/Screen";
import { Card, InfoRow, PrimaryButton } from "../../components/Ui";
import { useApp } from "../../context/AppContext";
import { theme } from "../../theme";
import { showAlert } from "../../components/platform";

type P<Name extends keyof RootStackParamList> = NativeStackScreenProps<RootStackParamList, Name>;

export function OfflineHomeScreen({ navigation }: P<"OfflineHome">) {
  const { pendingCount } = useApp();
  return <Screen title="Sin Internet" subtitle="Puedes seguir vendiendo. La aplicación guardará tus operaciones.">
    <Card tone="warning"><Text style={styles.big}>⌁</Text><Text style={styles.title}>Modo sin conexión activo</Text><Text style={styles.body}>Cuando vuelva Internet, enviaremos automáticamente los comprobantes pendientes.</Text></Card>
    <Card><InfoRow label="Pendientes" value={String(pendingCount)} /><InfoRow label="Tus ventas" value="Seguras en el celular" /></Card>
    <PrimaryButton label="HACER UNA VENTA" onPress={() => navigation.navigate("OfflineSale")} />
    <PrimaryButton label="VER PENDIENTES" onPress={() => navigation.navigate("PendingReceipts")} tone="outline" />
  </Screen>;
}

export function OfflineSaleScreen({ navigation }: P<"OfflineSale">) {
  return <Screen title="Venta sin Internet" subtitle="El flujo de venta es el mismo. Al final entregaremos una constancia temporal.">
    <Card tone="warning"><Text style={styles.title}>Puedes atender con normalidad</Text><Text style={styles.body}>Productos, cantidades, cliente y total quedarán guardados. El comprobante se enviará al recuperar conexión.</Text></Card>
    <PrimaryButton label="CONTINUAR CON LA VENTA" onPress={() => navigation.replace("NewSale")} />
  </Screen>;
}

export function TemporaryReceiptScreen({ navigation }: P<"TemporaryReceipt">) {
  const { lastReceipt } = useApp();
  return <Screen title="Venta guardada" subtitle="Entrega esta constancia temporal al cliente.">
    <View style={styles.center}><Text style={styles.ok}>✓</Text></View>
    <Card tone="warning"><Text style={styles.tempLabel}>CONSTANCIA TEMPORAL</Text><Text style={styles.tempNumber}>{lastReceipt?.temporaryNumber ?? "VT-000000"}</Text><Text style={styles.body}>Tu comprobante electrónico será enviado cuando vuelva la conexión.</Text></Card>
    <Card><InfoRow label="Fecha y hora" value={lastReceipt ? new Date(lastReceipt.createdAt).toLocaleString() : "-"} /><InfoRow label="Cliente" value={lastReceipt?.customer?.name ?? "Público general"} /><InfoRow label="Total" value={`S/ ${(lastReceipt?.total ?? 0).toFixed(2)}`} /></Card>
    <PrimaryButton label="COMPARTIR CONSTANCIA" onPress={() => showAlert("Constancia preparada", "En la siguiente integración podremos compartirla por Bluetooth, impresión local o cuando haya conexión.")} tone="outline" />
    <PrimaryButton label="NUEVA VENTA" onPress={() => navigation.reset({ index: 1, routes: [{ name: "Dashboard" }, { name: "OfflineSale" }] })} />
    <PrimaryButton label="VER PENDIENTES" onPress={() => navigation.navigate("PendingReceipts")} tone="outline" />
  </Screen>;
}

export function PendingReceiptsScreen({ navigation }: P<"PendingReceipts">) {
  const { queue, online } = useApp();
  const pending = queue.filter((r) => r.status !== "ACCEPTED");
  const retryable = pending.filter((r) => r.status !== "REJECTED");
  return <Screen title="Pendientes de envío" subtitle={pending.length ? "Se enviarán automáticamente cuando haya conexión." : "No tienes comprobantes pendientes."}>
    {pending.map((r) => <Card key={r.clientTransactionId} tone={r.status === "ERROR" || r.status === "REJECTED" ? "danger" : "warning"}><InfoRow label="Constancia" value={r.temporaryNumber} /><InfoRow label="Tipo" value={r.documentType} /><InfoRow label="Total" value={`S/ ${r.total.toFixed(2)}`} /><InfoRow label="Estado" value={r.status === "REJECTED" ? "Rechazado" : r.status === "ERROR" ? "Revisar" : r.status === "SYNCING" ? "Enviando" : "Pendiente"} />{r.errorMessage ? <Text style={styles.error}>{r.errorMessage}</Text> : null}</Card>)}
    <PrimaryButton label={online ? "SINCRONIZAR AHORA" : "SIN INTERNET: SE ENVIARÁ DESPUÉS"} disabled={!online || !retryable.length} onPress={() => navigation.navigate("Syncing")} />
    <PrimaryButton label="VOLVER AL INICIO" onPress={() => navigation.navigate("Dashboard")} tone="outline" />
  </Screen>;
}

export function SyncingScreen({ navigation }: P<"Syncing">) {
  const { online, syncNow } = useApp();
  const [message, setMessage] = useState("Preparando comprobantes...");
  useEffect(() => {
    if (!online) { showAlert("Sin Internet", "La sincronización empezará automáticamente cuando vuelva la conexión."); navigation.replace("PendingReceipts"); return; }
    let alive = true;
    setMessage("Enviando comprobantes pendientes...");
    syncNow().then((result) => { if (alive) navigation.replace("SyncResult", result); });
    return () => { alive = false; };
  }, [navigation, online, syncNow]);
  return <Screen title="Sincronizando" subtitle="No necesitas hacer nada."><View style={styles.syncBox}><Text style={styles.cloud}>☁</Text><Text style={styles.title}>{message}</Text><Text style={styles.body}>La cola procesa cada venta una sola vez y conserva los errores para revisión.</Text></View></Screen>;
}

export function SyncResultScreen({ navigation, route }: P<"SyncResult">) {
  const { queue } = useApp();
  const accepted = route.params?.accepted ?? queue.filter((r) => r.status === "ACCEPTED").length;
  const errors = route.params?.errors ?? queue.filter((r) => r.status === "ERROR").length;
  return <Screen title="Sincronización completada" subtitle="Revisa el resultado del envío.">
    <View style={styles.center}><Text style={styles.ok}>✓</Text></View>
    <Card tone="success"><InfoRow label="Aceptados" value={String(accepted)} /></Card>
    {errors ? <Card tone="danger"><InfoRow label="Necesitan revisión" value={String(errors)} /><Text style={styles.body}>Nada se elimina. Puedes corregir y reintentar.</Text></Card> : null}
    <PrimaryButton label="VER COMPROBANTES" onPress={() => navigation.navigate("ReceiptHistory")} />
    <PrimaryButton label="IR AL INICIO" onPress={() => navigation.reset({ index: 0, routes: [{ name: "Dashboard" }] })} tone="outline" />
  </Screen>;
}

const styles = StyleSheet.create({
  big: { fontSize: 46, textAlign: "center", color: theme.colors.warning }, title: { fontWeight: "900", color: theme.colors.text, textAlign: "center", fontSize: 17 }, body: { color: theme.colors.muted, textAlign: "center", lineHeight: 20 },
  center: { alignItems: "center" }, ok: { width: 70, height: 70, borderRadius: 35, backgroundColor: theme.colors.success, color: "white", textAlign: "center", lineHeight: 70, fontSize: 42, fontWeight: "900" },
  tempLabel: { color: theme.colors.warning, fontWeight: "900", textAlign: "center" }, tempNumber: { color: theme.colors.text, fontWeight: "900", fontSize: 28, textAlign: "center" }, error: { color: theme.colors.danger, fontWeight: "700" },
  syncBox: { flex: 1, minHeight: 380, justifyContent: "center", alignItems: "center", gap: 15 }, cloud: { color: theme.colors.blue, fontSize: 64 }
});
