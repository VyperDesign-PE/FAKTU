import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/types";
import { Screen } from "../../components/Screen";
import { Card, Chip, InfoRow, PrimaryButton, SectionTitle, TextField } from "../../components/Ui";
import { useApp } from "../../context/AppContext";
import { useAuth } from "../../context/AuthContext";
import { theme } from "../../theme";
import { attentionCount } from "../../domain/receiptMetrics";
import { localStatusInfo, remoteStatusInfo } from "../../domain/receiptStatus";
import { PAYMENT_METHODS } from "../../domain/types";
import { ReceiptActions } from "./ReceiptActions";
import { getBillingSettings, getRemoteReceiptByTransaction, getRucRegistryStatus, listBillingProviders, testBillingConnection, updateBillingSettings, type BillingEnvironment, type BillingProviderCode, type BillingProviderOption, type BillingSettings, type RemoteReceipt, type RucRegistryStatus } from "../../services/api";

type P<Name extends keyof RootStackParamList> = NativeStackScreenProps<RootStackParamList, Name>;

export function CatalogScreen({ navigation }: P<"Catalog">) {
  const { catalog, addItem } = useApp();
  return <Screen title="Mi catálogo" subtitle="Productos y servicios que puedes reutilizar en tus ventas.">
    <PrimaryButton label="+ AGREGAR PRODUCTO / SERVICIO" onPress={() => navigation.navigate("AddProduct")} />
    <View style={styles.grid}>{catalog.map((p) => <Pressable key={p.id} style={styles.product} onPress={() => { addItem(p); navigation.navigate("Cart"); }}><Text style={styles.productName}>{p.name}</Text><Text style={styles.price}>S/ {p.unitPrice.toFixed(2)}</Text><Text style={styles.tap}>Toca para agregar a una venta</Text></Pressable>)}</View>
  </Screen>;
}

const DOC_LABEL: Record<string, string> = { BOLETA: "Boleta", FACTURA: "Factura", NOTA_CREDITO: "Nota de crédito", NOTA_DEBITO: "Nota de débito" };

/**
 * Lista de comprobantes: primero las ventas del dispositivo que aún no llegan
 * al servidor, luego el historial guardado del negocio.
 */
type Row = {
  key: string;
  clientTransactionId: string;
  doc: string;
  number: string;
  customer: string;
  method: string;
  date: string;
  amount: string;
  negative: boolean;
  state: string;
  tone: "ok" | "warn" | "bad" | "muted";
  kind: "ALL" | "REVIEW" | "CREDIT" | "VOIDED";
};

const FILTERS: Array<{ value: Row["kind"] | "ALL"; label: string }> = [
  { value: "ALL", label: "Todos" },
  { value: "REVIEW", label: "Por revisar" },
  { value: "CREDIT", label: "Fiados" },
  { value: "VOIDED", label: "Anulados" }
];

export function ReceiptList({ onOpen }: { onOpen: (clientTransactionId: string) => void }) {
  const { queue, history } = useApp();
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"ALL" | "REVIEW" | "CREDIT" | "VOIDED">("ALL");
  const remoteIds = new Set(history.map((item) => item.clientTransactionId));
  const localOnly = queue.filter((item) => !remoteIds.has(item.clientTransactionId)).slice().reverse();

  const rows: Row[] = [
    ...localOnly.map((r): Row => ({
      key: r.clientTransactionId, clientTransactionId: r.clientTransactionId, doc: DOC_LABEL[r.documentType] ?? r.documentType,
      number: r.officialNumber ?? r.temporaryNumber, customer: r.customer?.name ?? "Público general",
      method: PAYMENT_METHODS.find((m) => m.value === r.paymentMethod)?.label ?? "", date: new Date(r.createdAt).toLocaleString("es-PE", { dateStyle: "short", timeStyle: "short" }),
      amount: `S/ ${r.total.toFixed(2)}`, negative: false, state: friendlyStatus(r.status),
      tone: r.status === "ERROR" || r.status === "REJECTED" ? "bad" : r.status === "ACCEPTED" ? "ok" : "warn",
      kind: r.status === "ERROR" || r.status === "REJECTED" ? "REVIEW" : r.paymentMethod === "CREDITO" ? "CREDIT" : "ALL"
    })),
    ...history.map((r): Row => ({
      key: r.id, clientTransactionId: r.clientTransactionId, doc: DOC_LABEL[r.documentType] ?? r.documentType,
      number: r.officialNumber ?? r.temporaryNumber, customer: r.customer?.name ?? "Público general",
      method: PAYMENT_METHODS.find((m) => m.value === r.paymentMethod)?.label ?? "", date: new Date(r.issueDate).toLocaleString("es-PE", { dateStyle: "short", timeStyle: "short" }),
      amount: `${r.documentType === "NOTA_CREDITO" ? "−" : ""}S/ ${r.total.toFixed(2)}`, negative: r.documentType === "NOTA_CREDITO",
      state: r.voided ? "Anulado" : friendlyRemoteStatus(r.status),
      tone: r.voided ? "muted" : r.status === "ACCEPTED" ? "ok" : r.status === "ERROR" || r.status === "REJECTED" ? "bad" : "warn",
      kind: r.voided ? "VOIDED" : r.status === "ERROR" || r.status === "REJECTED" ? "REVIEW" : r.paymentMethod === "CREDITO" ? "CREDIT" : "ALL"
    }))
  ];
  const term = search.trim().toLowerCase();
  const visible = rows.filter((row) => (filter === "ALL" || row.kind === filter) && (!term || `${row.number} ${row.customer} ${row.doc}`.toLowerCase().includes(term)));

  return <View style={{ gap: 12 }}>
    <View style={styles.listToolbar}>
      <TextInput value={search} onChangeText={setSearch} placeholder="Buscar por número o cliente…" placeholderTextColor={theme.colors.muted} style={styles.listSearch} accessibilityLabel="Buscar comprobante" />
      <View style={styles.filterRow}>{FILTERS.map((f) => <Chip key={f.value} label={f.label} active={filter === f.value} onPress={() => setFilter(f.value)} />)}</View>
    </View>
    {!rows.length ? <Card><Text style={styles.center}>Todavía no hay comprobantes. Tu primera venta aparecerá aquí.</Text></Card> : null}
    {rows.length && !visible.length ? <Card><Text style={styles.center}>No hay comprobantes con ese filtro.</Text></Card> : null}
    {visible.length ? <View style={styles.table}>
      {wide ? <View style={[styles.tr, styles.th]}>
        <Text style={[styles.thText, { flex: 1.3 }]}>Comprobante</Text><Text style={[styles.thText, { flex: 1.6 }]}>Cliente</Text><Text style={[styles.thText, { flex: 0.9 }]}>Pago</Text><Text style={[styles.thText, { flex: 1.1 }]}>Fecha</Text><Text style={[styles.thText, { flex: 0.9, textAlign: "right" }]}>Total</Text><Text style={[styles.thText, { flex: 1, textAlign: "right" }]}>Estado</Text>
      </View> : null}
      {visible.map((row) => <Pressable key={row.key} accessibilityRole="button" onPress={() => onOpen(row.clientTransactionId)} style={({ hovered }: { pressed: boolean; hovered?: boolean }) => [styles.tr, hovered && { backgroundColor: theme.colors.hover }]}>
        {wide ? <>
          <View style={{ flex: 1.3 }}><Text style={styles.tdStrong}>{row.number}</Text><Text style={styles.tdMuted}>{row.doc}</Text></View>
          <Text style={[styles.td, { flex: 1.6 }]} numberOfLines={1}>{row.customer}</Text>
          <Text style={[styles.td, { flex: 0.9 }]}>{row.method}</Text>
          <Text style={[styles.td, { flex: 1.1 }]}>{row.date}</Text>
          <Text style={[styles.tdStrong, { flex: 0.9, textAlign: "right" }]}>{row.amount}</Text>
          <View style={{ flex: 1, alignItems: "flex-end" }}><StatePill tone={row.tone} text={row.state} /></View>
        </> : <>
          <View style={{ flex: 1 }}>
            <Text style={styles.tdStrong}>{row.number} <Text style={styles.tdMuted}>· {row.doc}</Text></Text>
            <Text style={styles.tdMuted} numberOfLines={1}>{row.customer}{row.method ? ` · ${row.method}` : ""} · {row.date}</Text>
          </View>
          <View style={{ alignItems: "flex-end", gap: 4 }}><Text style={styles.tdStrong}>{row.amount}</Text><StatePill tone={row.tone} text={row.state} /></View>
        </>}
      </Pressable>)}
    </View> : null}
  </View>;
}

function StatePill({ tone, text }: { tone: Row["tone"]; text: string }) {
  const palette = { ok: [theme.colors.successSoft, theme.colors.success], warn: [theme.colors.warningSoft, theme.colors.warning], bad: [theme.colors.dangerSoft, theme.colors.danger], muted: [theme.colors.mutedSoft, theme.colors.muted] }[tone];
  return <View style={{ backgroundColor: palette[0], paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999 }}><Text style={{ color: palette[1], fontWeight: "800", fontSize: 11.5 }}>{text}</Text></View>;
}

export function ReceiptHistoryScreen({ navigation }: P<"ReceiptHistory">) {
  return <Screen title="Comprobantes" subtitle="Historial del negocio y ventas pendientes del dispositivo.">
    <ReceiptList onOpen={(clientTransactionId) => navigation.navigate("ReceiptDetail", { clientTransactionId })} />
    <PrimaryButton label="VER PENDIENTES" onPress={() => navigation.navigate("PendingReceipts")} tone="outline" />
  </Screen>;
}

export function ReceiptDetailScreen({ navigation, route }: P<"ReceiptDetail">) {
  const { queue, history, refreshHistory, online } = useApp();
  // Una venta aceptada se muestra desde el servidor (permite anularla); sin
  // Internet, o mientras está pendiente, se muestra la copia local.
  const local = queue.find((r) => r.clientTransactionId === route.params.clientTransactionId);
  const localReceipt = local && (local.status !== "ACCEPTED" || !online) ? local : undefined;
  const summary = history.find((r) => r.clientTransactionId === route.params.clientTransactionId);
  const [remoteReceipt, setRemoteReceipt] = useState<RemoteReceipt | undefined>(summary);
  const [actionMessage, setActionMessage] = useState<string>();

  useEffect(() => {
    if (localReceipt) return;
    getRemoteReceiptByTransaction(route.params.clientTransactionId)
      .then(setRemoteReceipt)
      .catch(() => undefined);
  }, [localReceipt, route.params.clientTransactionId]);

  async function afterAction(message: string) {
    setActionMessage(message);
    setRemoteReceipt(await getRemoteReceiptByTransaction(route.params.clientTransactionId));
    await refreshHistory();
  }

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
    <Card tone={remoteReceipt.voided ? "default" : remoteReceipt.status === "ACCEPTED" ? "success" : remoteReceipt.status === "ERROR" || remoteReceipt.status === "REJECTED" ? "danger" : "warning"}>
      <InfoRow label="Estado" value={remoteReceipt.voided ? "Anulado" : friendlyRemoteStatus(remoteReceipt.status)} />
      <InfoRow label="Tipo" value={DOC_LABEL[remoteReceipt.documentType] ?? remoteReceipt.documentType} />
      <InfoRow label="Fecha" value={new Date(remoteReceipt.issueDate).toLocaleString()} />
      {remoteReceipt.paymentMethod ? <InfoRow label="Pago" value={PAYMENT_METHODS.find((m) => m.value === remoteReceipt.paymentMethod)?.label ?? remoteReceipt.paymentMethod} /> : null}
      <InfoRow label="Cliente" value={remoteReceipt.customer?.name ?? "Público general"} />
      <InfoRow label="Subtotal" value={`S/ ${remoteReceipt.subtotal.toFixed(2)}`} />
      <InfoRow label="IGV" value={`S/ ${remoteReceipt.igv.toFixed(2)}`} />
      <InfoRow label="Total" value={`S/ ${remoteReceipt.total.toFixed(2)}`} />
    </Card>
    {remoteReceipt.items?.length ? <><SectionTitle>Detalle</SectionTitle><Card>{remoteReceipt.items.map((item) => <InfoRow key={`${item.id}-${item.name}`} label={`${item.name} × ${item.quantity}`} value={`S/ ${(item.quantity * item.unitPrice).toFixed(2)}`} />)}</Card></> : null}
    {remoteReceipt.message ? <Card tone={remoteReceipt.status === "ERROR" || remoteReceipt.status === "REJECTED" ? "danger" : "info"}><Text style={styles.body}>{remoteReceipt.message}</Text></Card> : null}
    {remoteReceipt.creditNote ? <Card tone={remoteReceipt.voided ? "danger" : "warning"}><InfoRow label="Nota de crédito" value={remoteReceipt.creditNote.officialNumber ?? "En proceso"} /><InfoRow label="Estado" value={friendlyRemoteStatus(remoteReceipt.creditNote.status)} /></Card> : null}
    {(remoteReceipt.documentType === "NOTA_CREDITO" || remoteReceipt.documentType === "NOTA_DEBITO") && remoteReceipt.noteDescription ? <Card><InfoRow label="Motivo" value={remoteReceipt.noteDescription} /></Card> : null}
    {actionMessage ? <Card tone="info"><Text style={styles.body}>{actionMessage}</Text></Card> : null}
    <PrimaryButton label="COMPARTIR" onPress={() => navigation.navigate("ShareReceipt", { clientTransactionId: route.params.clientTransactionId })} tone="outline" />
    {remoteReceipt.status === "ACCEPTED" && !remoteReceipt.voided && (remoteReceipt.documentType === "BOLETA" || remoteReceipt.documentType === "FACTURA")
      ? <PrimaryButton label="CREAR GUÍA DE REMISIÓN" onPress={() => navigation.navigate("GuideForm", { receiptClientTransactionId: route.params.clientTransactionId })} tone="outline" />
      : null}
    <ReceiptActions receipt={remoteReceipt} online={online} onChanged={afterAction} />
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
      .catch((error) => setMessage(error instanceof Error ? error.message : "No pudimos cargar la configuración. Revisa tu conexión o tus permisos e inténtalo de nuevo."))
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
      {providers.filter((item) => item.canIssue !== false).map((item) => (
        <Chip key={item.code} label={item.name} active={providerCode === item.code} onPress={() => setProviderCode(item.code)} />
      ))}
    </View>
    {selected ? <Card tone="info"><Text style={styles.body}>{selected.note}</Text></Card> : null}
    {providers.some((item) => item.canIssue === false) ? <Text style={styles.body}>No disponibles todavía: {providers.filter((item) => item.canIssue === false).map((item) => item.name).join(", ")} (pendientes de homologación).</Text> : null}

    <SectionTitle>Ambiente</SectionTitle>
    <View style={styles.chipWrap}>
      <Chip label="Pruebas / Sandbox" active={environment === "sandbox"} onPress={() => setEnvironment("sandbox")} />
      <Chip label="Producción" active={environment === "production"} onPress={() => setEnvironment("production")} />
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
  const errors = attentionCount(queue);
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

const friendlyStatus = (status: Parameters<typeof localStatusInfo>[0]) => localStatusInfo(status).label;
const friendlyRemoteStatus = (status: Parameters<typeof remoteStatusInfo>[0]) => remoteStatusInfo(status).label;

const styles = StyleSheet.create({
  listToolbar: { gap: 10 },
  listSearch: { minHeight: 46, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 14, paddingHorizontal: 14, backgroundColor: theme.colors.surface, color: theme.colors.text, fontSize: 16 },
  filterRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  table: { backgroundColor: theme.colors.surface, borderRadius: 16, borderWidth: 1, borderColor: theme.colors.border, overflow: "hidden" },
  tr: { minHeight: 58, paddingHorizontal: 16, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border },
  th: { minHeight: 42, backgroundColor: theme.colors.tableHead },
  thText: { color: theme.colors.muted, fontWeight: "800", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4 },
  td: { color: theme.colors.text },
  tdStrong: { color: theme.colors.text, fontWeight: "800" },
  tdMuted: { color: theme.colors.muted, fontSize: 12.5, fontWeight: "500" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 }, product: { width: "48%", minHeight: 120, padding: 14, backgroundColor: theme.colors.surface, borderRadius: 15, borderWidth: 1, borderColor: theme.colors.border }, productName: { fontWeight: "900", color: theme.colors.text }, price: { fontWeight: "900", color: theme.colors.primaryText, marginTop: 8 }, tap: { color: theme.colors.muted, fontSize: 11, marginTop: 12 }, center: { textAlign: "center", color: theme.colors.muted },
  statusTitle: { color: theme.colors.text, fontSize: 19, fontWeight: "900", textAlign: "center" }, body: { color: theme.colors.muted, lineHeight: 20 }, error: { color: theme.colors.danger, fontWeight: "700" }, supportTitle: { color: theme.colors.text, fontWeight: "900", fontSize: 16 }, chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 }
});
