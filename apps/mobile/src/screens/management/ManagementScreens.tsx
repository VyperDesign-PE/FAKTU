import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/types";
import { Screen } from "../../components/Screen";
import { Card, Chip, InfoRow, PrimaryButton, SectionTitle, TextField } from "../../components/Ui";
import { useApp } from "../../context/AppContext";
import { useAuth } from "../../context/AuthContext";
import { theme } from "../../theme";
import { getBillingSettings, getRemoteReceiptByTransaction, getRucRegistryStatus, listBillingProviders, testBillingConnection, updateBillingSettings, type BillingEnvironment, type BillingProviderCode, type BillingProviderOption, type BillingSettings, type RemoteReceipt, type RucRegistryStatus } from "../../services/api";

type P<Name extends keyof RootStackParamList> = NativeStackScreenProps<RootStackParamList, Name>;

export function CatalogScreen({ navigation }: P<"Catalog">) {
  const { catalog, addItem } = useApp();
  return <Screen title="Mi catálogo" subtitle="Productos y servicios que puedes reutilizar en tus ventas.">
    <PrimaryButton label="+ AGREGAR PRODUCTO / SERVICIO" onPress={() => navigation.navigate("AddProduct")} />
    <View style={styles.grid}>{catalog.map((p) => <Pressable key={p.id} style={styles.product} onPress={() => { addItem(p); navigation.navigate("Cart"); }}><Text style={styles.productName}>{p.name}</Text><Text style={styles.price}>S/ {p.unitPrice.toFixed(2)}</Text><Text style={styles.tap}>Toca para agregar a una venta</Text></Pressable>)}</View>
  </Screen>;
}

export function ReceiptHistoryScreen({ navigation }: P<"ReceiptHistory">) {
  const { queue, history } = useApp();
  const remoteIds = new Set(history.map((item) => item.clientTransactionId));
  const localOnly = queue.filter((item) => !remoteIds.has(item.clientTransactionId)).slice().reverse();

  return <Screen title="Comprobantes" subtitle="Historial persistido del negocio y ventas pendientes del dispositivo.">
    {!history.length && !localOnly.length ? <Card><Text style={styles.center}>Todavía no hay comprobantes.</Text></Card> : null}

    {localOnly.map((r) => <Pressable key={r.clientTransactionId} onPress={() => navigation.navigate("ReceiptDetail", { clientTransactionId: r.clientTransactionId })}>
      <Card tone={r.status === "ERROR" || r.status === "REJECTED" ? "danger" : r.status === "ACCEPTED" ? "success" : "warning"}>
        <InfoRow label={r.documentType} value={r.officialNumber ?? r.temporaryNumber} />
        <InfoRow label="Total" value={`S/ ${r.total.toFixed(2)}`} />
        <InfoRow label="Estado" value={friendlyStatus(r.status)} />
      </Card>
    </Pressable>)}

    {history.map((r) => <Pressable key={r.id} onPress={() => navigation.navigate("ReceiptDetail", { clientTransactionId: r.clientTransactionId })}>
      <Card tone={r.status === "ACCEPTED" ? "success" : r.status === "ERROR" || r.status === "REJECTED" ? "danger" : "warning"}>
        <InfoRow label={r.documentType} value={r.officialNumber ?? r.temporaryNumber} />
        <InfoRow label="Total" value={`S/ ${r.total.toFixed(2)}`} />
        <InfoRow label="Estado" value={friendlyRemoteStatus(r.status)} />
      </Card>
    </Pressable>)}

    <PrimaryButton label="VER PENDIENTES" onPress={() => navigation.navigate("PendingReceipts")} tone="outline" />
  </Screen>;
}

export function ReceiptDetailScreen({ navigation, route }: P<"ReceiptDetail">) {
  const { queue, history } = useApp();
  const localReceipt = queue.find((r) => r.clientTransactionId === route.params.clientTransactionId);
  const summary = history.find((r) => r.clientTransactionId === route.params.clientTransactionId);
  const [remoteReceipt, setRemoteReceipt] = useState<RemoteReceipt | undefined>(summary);

  useEffect(() => {
    if (localReceipt) return;
    getRemoteReceiptByTransaction(route.params.clientTransactionId)
      .then(setRemoteReceipt)
      .catch(() => undefined);
  }, [localReceipt, route.params.clientTransactionId]);

  if (localReceipt) {
    return <Screen title="Detalle del comprobante" subtitle={localReceipt.officialNumber ?? localReceipt.temporaryNumber}>
      <Card tone={localReceipt.status === "ACCEPTED" ? "success" : localReceipt.status === "ERROR" || localReceipt.status === "REJECTED" ? "danger" : "warning"}>
        <InfoRow label="Estado" value={friendlyStatus(localReceipt.status)} />
        <InfoRow label="Tipo" value={localReceipt.documentType} />
        <InfoRow label="Fecha" value={new Date(localReceipt.createdAt).toLocaleString()} />
        <InfoRow label="Cliente" value={localReceipt.customer?.name ?? "Público general"} />
        <InfoRow label="Total" value={`S/ ${localReceipt.total.toFixed(2)}`} />
      </Card>
      <SectionTitle>Detalle</SectionTitle>
      <Card>{localReceipt.items.map((item) => <InfoRow key={item.id} label={`${item.name} × ${item.quantity}`} value={`S/ ${(item.quantity * item.unitPrice).toFixed(2)}`} />)}</Card>
      {localReceipt.errorMessage ? <Card tone="danger"><Text style={styles.error}>{localReceipt.errorMessage}</Text></Card> : null}
      <PrimaryButton label="COMPARTIR" onPress={() => navigation.navigate("ShareReceipt", { clientTransactionId: route.params.clientTransactionId })} tone="outline" />
    </Screen>;
  }

  if (!remoteReceipt) return <Screen title="Comprobante"><Card><Text>Cargando comprobante guardado...</Text></Card></Screen>;

  return <Screen title="Detalle del comprobante" subtitle={remoteReceipt.officialNumber ?? remoteReceipt.temporaryNumber}>
    <Card tone={remoteReceipt.status === "ACCEPTED" ? "success" : remoteReceipt.status === "ERROR" || remoteReceipt.status === "REJECTED" ? "danger" : "warning"}>
      <InfoRow label="Estado" value={friendlyRemoteStatus(remoteReceipt.status)} />
      <InfoRow label="Tipo" value={remoteReceipt.documentType} />
      <InfoRow label="Fecha" value={new Date(remoteReceipt.issueDate).toLocaleString()} />
      <InfoRow label="Cliente" value={remoteReceipt.customer?.name ?? "Público general"} />
      <InfoRow label="Subtotal" value={`S/ ${remoteReceipt.subtotal.toFixed(2)}`} />
      <InfoRow label="IGV" value={`S/ ${remoteReceipt.igv.toFixed(2)}`} />
      <InfoRow label="Total" value={`S/ ${remoteReceipt.total.toFixed(2)}`} />
    </Card>
    {remoteReceipt.items?.length ? <><SectionTitle>Detalle</SectionTitle><Card>{remoteReceipt.items.map((item) => <InfoRow key={`${item.id}-${item.name}`} label={`${item.name} × ${item.quantity}`} value={`S/ ${(item.quantity * item.unitPrice).toFixed(2)}`} />)}</Card></> : null}
    {remoteReceipt.message ? <Card tone={remoteReceipt.status === "ERROR" || remoteReceipt.status === "REJECTED" ? "danger" : "info"}><Text style={styles.body}>{remoteReceipt.message}</Text></Card> : null}
    <PrimaryButton label="COMPARTIR" onPress={() => navigation.navigate("ShareReceipt", { clientTransactionId: route.params.clientTransactionId })} tone="outline" />
  </Screen>;
}

export function BillingSettingsScreen({ navigation }: P<"BillingSettings">) {
  const [settings, setSettings] = useState<BillingSettings>();
  const [providers, setProviders] = useState<BillingProviderOption[]>([]);
  const [providerCode, setProviderCode] = useState<BillingProviderCode>("mock");
  const [environment, setEnvironment] = useState<BillingEnvironment>("sandbox");
  const [accountRef, setAccountRef] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    Promise.all([getBillingSettings(), listBillingProviders()])
      .then(([current, catalog]) => {
        setSettings(current);
        setProviderCode(current.providerCode);
        setEnvironment(current.environment);
        setAccountRef(current.providerAccountRef ?? "");
        setProviders(catalog.providers);
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : "No pudimos cargar la configuracion."))
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true);
    setMessage(undefined);
    try {
      const updated = await updateBillingSettings({
        providerCode,
        environment,
        providerAccountRef: accountRef.trim() || undefined
      });
      setSettings(updated);
      setMessage("Configuracion guardada. Ahora puedes probar la conexion.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No pudimos guardar la configuracion.");
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    setMessage(undefined);
    try {
      const result = await testBillingConnection();
      setMessage(result.message);
      setSettings(await getBillingSettings());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No pudimos verificar la conexion.");
      setSettings(await getBillingSettings().catch(() => settings));
    } finally {
      setTesting(false);
    }
  }

  if (loading) {
    return <Screen title="Facturacion electronica" subtitle="Configuracion segura del proveedor."><Card><ActivityIndicator color={theme.colors.primary} /><Text style={styles.center}>Cargando configuracion...</Text></Card></Screen>;
  }

  const selected = providers.find((item) => item.code === providerCode);
  const status = settings?.connectionStatus ?? "NOT_TESTED";
  const statusTone = status === "CONNECTED" ? "success" : status === "ERROR" ? "danger" : "warning";
  const statusText = status === "CONNECTED" ? "Conexion verificada" : status === "ERROR" ? "Necesita revision" : "Todavia no se ha probado";

  return <Screen title="Facturacion electronica" subtitle="Elige proveedor y ambiente sin exponer tokens en el celular.">
    <Card tone={statusTone}>
      <Text style={styles.statusTitle}>{statusText}</Text>
      <InfoRow label="Proveedor" value={selected?.name ?? providerCode} />
      <InfoRow label="Ambiente" value={environment === "sandbox" ? "Pruebas" : "Produccion"} />
      <InfoRow label="Credencial segura" value={settings?.credentialConfigured ? "Configurada" : "Pendiente"} />
      {settings?.lastTestedAt ? <InfoRow label="Ultima prueba" value={new Date(settings.lastTestedAt).toLocaleString()} /> : null}
      {settings?.lastError ? <Text style={styles.error}>{settings.lastError}</Text> : null}
    </Card>

    <SectionTitle>Proveedor</SectionTitle>
    <View style={styles.chipWrap}>
      {providers.filter((item) => ["mock", "apisperu", "nubefact", "efact", "senda"].includes(item.code)).map((item) => (
        <Chip key={item.code} label={item.name} active={providerCode === item.code} onPress={() => setProviderCode(item.code)} />
      ))}
    </View>
    {selected ? <Card tone="info"><Text style={styles.body}>{selected.note}</Text></Card> : null}

    <SectionTitle>Ambiente</SectionTitle>
    <View style={styles.chipWrap}>
      <Chip label="Pruebas / Sandbox" active={environment === "sandbox"} onPress={() => setEnvironment("sandbox")} />
      <Chip label="Produccion" active={environment === "production"} onPress={() => setEnvironment("production")} />
    </View>

    <TextField
      label="Referencia de cuenta del proveedor (opcional)"
      value={accountRef}
      onChangeText={setAccountRef}
      placeholder="Ej. codigo de cuenta reseller"
      autoCapitalize="none"
    />

    <Card tone="warning">
      <Text style={styles.body}>Los tokens, certificados y credenciales reales se guardan solo en infraestructura segura del backend. Nunca se muestran ni se almacenan en esta app.</Text>
    </Card>

    {message ? <Card tone={message.toLowerCase().includes("no pudimos") || message.toLowerCase().includes("falta") ? "danger" : "info"}><Text style={styles.body}>{message}</Text></Card> : null}
    <PrimaryButton label={saving ? "GUARDANDO..." : "GUARDAR CONFIGURACION"} onPress={save} disabled={saving || testing} />
    <PrimaryButton label={testing ? "PROBANDO CONEXION..." : "PROBAR CONEXION"} onPress={testConnection} disabled={saving || testing} tone="outline" />
    <PrimaryButton label="VER ESTADO DEL SISTEMA" onPress={() => navigation.navigate("SystemStatus")} tone="outline" />
  </Screen>;
}

export function SystemStatusScreen({ navigation }: P<"SystemStatus">) {
  const { online, pendingCount, queue } = useApp();
  const [rucRegistry, setRucRegistry] = useState<RucRegistryStatus>();
  const errors = queue.filter((r) => r.status === "ERROR" || r.status === "REJECTED").length;
  const title = !online ? "Sin Internet" : errors ? "Hay algo que revisar" : pendingCount ? "Hay comprobantes pendientes" : "Todo funciona correctamente";

  useEffect(() => {
    if (!online) return;
    getRucRegistryStatus().then(setRucRegistry).catch(() => undefined);
  }, [online]);

  return <Screen title="Estado del sistema" subtitle="Mensajes simples, sin términos técnicos.">
    <Card tone={!online || pendingCount ? "warning" : "success"}><Text style={styles.statusTitle}>{title}</Text><Text style={styles.body}>{!online ? "Puedes seguir vendiendo. Guardaremos tus ventas y las enviaremos al volver la conexión." : errors ? "Hay comprobantes que necesitan revisión. No se ha perdido ninguna venta." : pendingCount ? "La aplicación intentará enviarlos automáticamente." : "Tu negocio está listo para emitir."}</Text></Card>
    <Card><InfoRow label="Internet" value={online ? "Disponible" : "Sin conexión"} /><InfoRow label="Pendientes" value={String(pendingCount)} /><InfoRow label="Necesitan revisión" value={String(errors)} /><InfoRow label="Tus ventas" value="Guardadas" /><InfoRow label="Envío automático" value="Activo" /></Card>
    {online ? <Card tone={rucRegistry?.ready ? "success" : "warning"}>
      <Text style={styles.statusTitle}>Consulta RUC</Text>
      <InfoRow label="Fuente" value="Padrón oficial SUNAT" />
      <InfoRow label="Estado" value={rucRegistry?.ready ? "Disponible" : "Preparando datos"} />
      {rucRegistry?.sourceUpdatedAt ? <InfoRow label="Actualizado" value={rucRegistry.sourceUpdatedAt} /> : null}
      {rucRegistry?.lastRun?.status === "FAILED" ? <Text style={styles.body}>La última actualización tuvo un problema. Seguimos usando el último padrón válido.</Text> : null}
    </Card> : null}
    {pendingCount ? <PrimaryButton label="VER PENDIENTES" onPress={() => navigation.navigate("PendingReceipts")} /> : null}
    <PrimaryButton label="AYUDA" onPress={() => navigation.navigate("Support")} tone="outline" />
  </Screen>;
}

export function BusinessScreen({ navigation }: P<"Business">) {
  const { profile } = useApp();
  const { user, signOut } = useAuth();
  async function logout() {
    await signOut();
    navigation.reset({ index: 0, routes: [{ name: "Login" }] });
  }
  return <Screen title="Mi negocio" subtitle="Datos principales y accesos de configuración.">
    <Card tone="success"><InfoRow label="Cuenta" value={user?.email ?? "-"} /><InfoRow label="Negocio" value={profile.tradeName ?? profile.businessName ?? "-"} /><InfoRow label="RUC" value={profile.ruc ?? "-"} /><InfoRow label="Estado" value={profile.taxpayerStatus ?? "-"} /><InfoRow label="Dirección" value={profile.address ?? "-"} /><InfoRow label="Usuario SOL" value={profile.sunatUser ?? "No registrado"} /></Card>
    <Card tone="info"><Text style={styles.body}>La Clave SOL no se muestra ni se almacena. Si la autorización real expira, la app debe guiar al usuario para renovarla mediante SUNAT/PSE.</Text></Card>
    <PrimaryButton label="ESTADO DEL SISTEMA" onPress={() => navigation.navigate("SystemStatus")} />
    <PrimaryButton label="AYUDA / SOPORTE" onPress={() => navigation.navigate("Support")} tone="outline" />
    <PrimaryButton label="CERRAR SESIÓN" onPress={logout} tone="outline" />
  </Screen>;
}

export function SupportScreen({ navigation }: P<"Support">) {
  return <Screen title="Ayuda y soporte" subtitle="Primero explicamos el problema en lenguaje sencillo.">
    <Card><Text style={styles.supportTitle}>¿No puedes emitir?</Text><Text style={styles.body}>Revisa el Estado del sistema. Si no hay Internet, puedes seguir vendiendo. Si hay una observación, el comprobante queda guardado para corregirlo.</Text></Card>
    <Card><Text style={styles.supportTitle}>¿Olvidaste tu Clave SOL?</Text><Text style={styles.body}>La recuperación debe hacerse desde los canales oficiales de SUNAT. La aplicación nunca debe conocer ni guardar una contraseña recuperada fuera del flujo de autorización.</Text></Card>
    <Card tone="success"><Text style={styles.supportTitle}>Soporte humano</Text><Text style={styles.body}>En producción agregaremos WhatsApp/chat de soporte con el contexto del error, sin exponer credenciales.</Text></Card>
    <PrimaryButton label="VOLVER AL ESTADO DEL SISTEMA" onPress={() => navigation.navigate("SystemStatus")} />
    <PrimaryButton label="IR AL INICIO" onPress={() => navigation.reset({ index: 0, routes: [{ name: "Dashboard" }] })} tone="outline" />
  </Screen>;
}

function friendlyStatus(status: "PENDING" | "SYNCING" | "ACCEPTED" | "REJECTED" | "ERROR") { return { PENDING: "Pendiente", SYNCING: "Enviando", ACCEPTED: "Aceptado", REJECTED: "Rechazado", ERROR: "Revisar" }[status]; }
function friendlyRemoteStatus(status: "ACCEPTED" | "PENDING" | "REJECTED" | "ERROR") { return { ACCEPTED: "Aceptado", PENDING: "Pendiente", REJECTED: "Rechazado", ERROR: "Revisar" }[status]; }

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 }, product: { width: "48%", minHeight: 120, padding: 14, backgroundColor: "white", borderRadius: 15, borderWidth: 1, borderColor: theme.colors.border }, productName: { fontWeight: "900", color: theme.colors.text }, price: { fontWeight: "900", color: theme.colors.primary, marginTop: 8 }, tap: { color: theme.colors.muted, fontSize: 11, marginTop: 12 }, center: { textAlign: "center", color: theme.colors.muted },
  statusTitle: { color: theme.colors.text, fontSize: 19, fontWeight: "900", textAlign: "center" }, body: { color: theme.colors.muted, lineHeight: 20 }, error: { color: theme.colors.danger, fontWeight: "700" }, supportTitle: { color: theme.colors.text, fontWeight: "900", fontSize: 16 }, chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 }
});
