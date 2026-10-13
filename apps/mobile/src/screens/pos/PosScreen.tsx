import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/types";
import { ResponsiveShell } from "../../components/ResponsiveShell";
import { Chip, PrimaryButton, TextField } from "../../components/Ui";
import { CustomerDocumentLookupField } from "../../components/customer/CustomerDocumentLookupField";
import { showAlert } from "../../components/platform";
import { useApp } from "../../context/AppContext";
import { PAYMENT_METHODS, type Customer, type PaymentMethod, type Product } from "../../domain/types";
import { theme } from "../../theme";
import { quoteTotals } from "../../domain/pricing";
import { mustIdentifyCustomer } from "../../domain/documentRules";

type Props = NativeStackScreenProps<RootStackParamList, "POSVenta">;

const money = (value: number) => `S/ ${value.toFixed(2)}`;
const BILLS = [10, 20, 50, 100, 200];

export function stockLabel(product: Pick<Product, "stockQty" | "minStock">) {
  if (product.stockQty === null || product.stockQty === undefined) return undefined;
  if (product.stockQty <= 0) return { text: "Agotado", tone: "danger" as const };
  if (product.stockQty <= (product.minStock ?? 0)) return { text: `Quedan ${product.stockQty}`, tone: "warning" as const };
  return { text: `${product.stockQty} en stock`, tone: "ok" as const };
}

export function PosScreen({ navigation }: Props) {
  const { catalog, draft, addItem, setItemQuantity, removeItem, setDocumentType, setPayment, createReceipt, online, resetDraft } = useApp();
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const [view, setView] = useState<"catalog" | "ticket">("catalog");
  const [search, setSearch] = useState("");
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickName, setQuickName] = useState("");
  const [quickPrice, setQuickPrice] = useState("");
  const [mode, setMode] = useState<"NONE" | "DNI" | "RUC">("NONE");
  const [number, setNumber] = useState("");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [received, setReceived] = useState("");
  const [busy, setBusy] = useState(false);

  const { total } = quoteTotals(draft.items);
  const count = draft.items.reduce((sum, item) => sum + item.quantity, 0);
  const isFactura = draft.documentType === "FACTURA";
  const isCredit = draft.paymentMethod === "CREDITO";
  const isCash = draft.paymentMethod === "EFECTIVO";
  const mustIdentify = mustIdentifyCustomer({ documentType: draft.documentType, total, paymentMethod: draft.paymentMethod });
  const receivedAmount = received.trim() ? Number(received.replace(",", ".")) : undefined;
  const change = isCash && receivedAmount !== undefined && Number.isFinite(receivedAmount) ? receivedAmount - total : undefined;
  const effectiveMode = isFactura ? "RUC" : mode;

  const products = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = term ? catalog.filter((p) => p.name.toLowerCase().includes(term)) : catalog;
    return [...list].sort((a, b) => Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)) || a.name.localeCompare(b.name));
  }, [catalog, search]);

  function choosePayment(method: PaymentMethod) {
    setPayment(method, method === "EFECTIVO" ? receivedAmount : undefined);
    if (method === "CREDITO" && mode === "NONE" && !isFactura) setMode("DNI");
  }

  function chooseDocument(type: "BOLETA" | "FACTURA") {
    if (type === "FACTURA" && isCredit) return showAlert("Fiado con boleta", "Las ventas fiadas se registran con boleta. Cambia el medio de pago para emitir factura.");
    setDocumentType(type);
    if (type === "FACTURA") { setMode("RUC"); setNumber(""); setName(""); }
  }

  function changeMode(next: "NONE" | "DNI" | "RUC") {
    if (isFactura && next !== "RUC") return showAlert("Factura con RUC", "Para emitir factura necesitamos el RUC del cliente.");
    if (mustIdentify && next === "NONE") return showAlert("Identifica al cliente", isCredit ? "Para fiar necesitamos saber a quién." : "Para esta venta necesitamos identificar al cliente.");
    setMode(next); setNumber(""); setName(""); setAddress("");
  }

  function setReceivedValue(value: string) {
    setReceived(value);
    const parsed = value.trim() ? Number(value.replace(",", ".")) : undefined;
    setPayment("EFECTIVO", parsed !== undefined && Number.isFinite(parsed) ? parsed : undefined);
  }

  function addQuick() {
    const price = Number(quickPrice.replace(",", "."));
    if (!quickName.trim() || !Number.isFinite(price) || price <= 0) return showAlert("Revisa los datos", "Escribe qué vendes y cuánto cuesta.");
    addItem({ id: `manual-${Date.now()}`, name: quickName.trim(), unitPrice: price, unit: "ZZ", favorite: false });
    setQuickName(""); setQuickPrice(""); setQuickOpen(false);
  }

  async function charge() {
    if (!draft.items.length) return showAlert("Venta vacía", "Toca un producto para agregarlo.");
    let customer: Customer | undefined;
    if (effectiveMode !== "NONE") {
      const expected = effectiveMode === "DNI" ? 8 : 11;
      if (number.length !== expected) return showAlert("Documento incompleto", effectiveMode === "DNI" ? "Ingresa los 8 dígitos del DNI." : "Ingresa los 11 dígitos del RUC.");
      if (!name.trim()) return showAlert("Falta el nombre", "Busca el documento o escribe el nombre del cliente.");
      customer = { documentType: effectiveMode, documentNumber: number, name: name.trim(), ...(address.trim() ? { address: address.trim() } : {}), ...(phone.trim() ? { phone: phone.trim() } : {}) };
    } else if (mustIdentify) {
      return showAlert("Identifica al cliente", isCredit ? "Para fiar necesitamos saber a quién." : "Para esta venta necesitamos identificar al cliente.");
    }
    if (isCash && receivedAmount !== undefined && (!Number.isFinite(receivedAmount) || receivedAmount + 0.001 < total)) {
      return showAlert("Monto insuficiente", "Lo recibido es menor al total. Corrígelo o déjalo vacío.");
    }
    setBusy(true);
    try {
      await createReceipt({ customer, amountReceived: isCash ? receivedAmount : undefined });
      setReceived(""); setMode("NONE"); setNumber(""); setName(""); setAddress(""); setPhone("");
      setView("catalog");
      navigation.navigate(online ? "EmissionResult" : "TemporaryReceipt");
    } catch (error) {
      showAlert("No pudimos registrar la venta", error instanceof Error ? error.message : "Intenta nuevamente.");
    } finally {
      setBusy(false);
    }
  }

  const catalogPane = (
    <View style={styles.pane}>
      <View style={styles.searchRow}>
        <TextInput value={search} onChangeText={setSearch} placeholder="Buscar producto…" placeholderTextColor={theme.colors.muted} style={styles.search} accessibilityLabel="Buscar producto" />
        <Pressable accessibilityRole="button" onPress={() => setQuickOpen((v) => !v)} style={styles.quickBtn}><Text style={styles.quickBtnText}>＋ Otro</Text></Pressable>
      </View>
      {quickOpen ? (
        <View style={styles.quickBox}>
          <TextField label="¿Qué vendes?" value={quickName} onChangeText={setQuickName} placeholder="Ej. Reparación de puerta" />
          <TextField label="Precio (S/)" value={quickPrice} onChangeText={setQuickPrice} keyboardType="decimal-pad" placeholder="80.00" />
          <PrimaryButton label="AGREGAR AL TICKET" onPress={addQuick} tone="success" />
        </View>
      ) : null}
      <ScrollView contentContainerStyle={styles.grid} keyboardShouldPersistTaps="handled">
        {products.map((product) => {
          const stock = stockLabel(product);
          const inCart = draft.items.find((item) => item.id === product.id)?.quantity ?? 0;
          return (
            <Pressable key={product.id} accessibilityRole="button" accessibilityLabel={`Agregar ${product.name}`} onPress={() => addItem(product)} style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => [styles.tile, (hovered || pressed) && styles.tileHover, inCart > 0 && styles.tileActive]}>
              {inCart > 0 ? <View style={styles.badge}><Text style={styles.badgeText}>{inCart}</Text></View> : null}
              <Text style={styles.tileName} numberOfLines={2}>{product.name}</Text>
              <View>
                <Text style={styles.tilePrice}>{money(product.unitPrice)}</Text>
                {stock ? <Text style={[styles.stock, stock.tone === "danger" && { color: theme.colors.danger }, stock.tone === "warning" && { color: theme.colors.warning }]}>{stock.text}</Text> : null}
              </View>
            </Pressable>
          );
        })}
        <Pressable accessibilityRole="button" onPress={() => navigation.navigate("ProductForm")} style={[styles.tile, styles.tileNew]}>
          <Text style={styles.tileNewPlus}>＋</Text>
          <Text style={styles.tileNewText}>Producto nuevo</Text>
        </Pressable>
      </ScrollView>
    </View>
  );

  const ticketPane = (
    <View style={[styles.ticket, wide && styles.ticketWide]}>
      <ScrollView contentContainerStyle={styles.ticketBody} keyboardShouldPersistTaps="handled">
        <View style={styles.ticketHead}>
          <Text style={styles.ticketTitle}>Ticket · {count} {count === 1 ? "producto" : "productos"}</Text>
          {draft.items.length ? <Pressable onPress={resetDraft}><Text style={styles.clear}>Vaciar</Text></Pressable> : null}
        </View>

        {!draft.items.length ? <Text style={styles.empty}>Toca un producto para empezar a vender.</Text> : null}
        {draft.items.map((item) => (
          <View key={item.id} style={styles.line}>
            <View style={{ flex: 1 }}>
              <Text style={styles.lineName} numberOfLines={2}>{item.name}</Text>
              <Text style={styles.lineSub}>{money(item.unitPrice)} c/u</Text>
            </View>
            <View style={styles.stepper}>
              <Pressable accessibilityLabel={`Quitar uno de ${item.name}`} onPress={() => setItemQuantity(item.id, item.quantity - 1)} style={styles.stepBtn}><Text style={styles.stepText}>−</Text></Pressable>
              <Text style={styles.qty}>{item.quantity}</Text>
              <Pressable accessibilityLabel={`Agregar uno de ${item.name}`} onPress={() => setItemQuantity(item.id, item.quantity + 1)} style={styles.stepBtn}><Text style={styles.stepText}>＋</Text></Pressable>
            </View>
            <Text style={styles.lineTotal}>{money(item.quantity * item.unitPrice)}</Text>
            <Pressable accessibilityLabel={`Eliminar ${item.name}`} onPress={() => removeItem(item.id)}><Text style={styles.remove}>×</Text></Pressable>
          </View>
        ))}

        <Text style={styles.sectionLabel}>Comprobante</Text>
        <View style={styles.chips}>
          <Chip label="Boleta" active={!isFactura} onPress={() => chooseDocument("BOLETA")} />
          <Chip label="Factura" active={isFactura} onPress={() => chooseDocument("FACTURA")} />
        </View>

        <Text style={styles.sectionLabel}>Cliente {mustIdentify ? "(obligatorio)" : "(opcional)"}</Text>
        <View style={styles.chips}>
          {!mustIdentify ? <Chip label="Público general" active={effectiveMode === "NONE"} onPress={() => changeMode("NONE")} /> : null}
          {!isFactura ? <Chip label="DNI" active={effectiveMode === "DNI"} onPress={() => changeMode("DNI")} /> : null}
          <Chip label="RUC" active={effectiveMode === "RUC"} onPress={() => changeMode("RUC")} />
        </View>
        {effectiveMode !== "NONE" ? (
          <CustomerDocumentLookupField
            tipoDoc={effectiveMode}
            numero={number}
            nombre={name}
            online={online}
            onNumeroChange={setNumber}
            onNombreChange={setName}
            onResolved={(result) => setAddress(result.direccion ?? "")}
          />
        ) : null}
        {isFactura ? <TextField label="Dirección del cliente" value={address} onChangeText={setAddress} placeholder="Si la dejas vacía se completa con SUNAT" /> : null}
        {isCredit ? <TextField label="Celular del cliente (para recordarle su deuda)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="987654321" /> : null}

        <Text style={styles.sectionLabel}>¿Cómo paga?</Text>
        <View style={styles.chips}>
          {PAYMENT_METHODS.map((option) => <Chip key={option.value} label={option.value === "CREDITO" ? "Fiado" : option.label} active={draft.paymentMethod === option.value} onPress={() => choosePayment(option.value)} />)}
        </View>
        {isCredit ? <Text style={styles.hint}>Se emite la boleta y queda como deuda del cliente en “Por cobrar”.</Text> : null}
        {isCash && total > 0 ? (
          <View style={{ gap: 8 }}>
            <View style={styles.chips}>
              <Chip label="Exacto" active={receivedAmount === total} onPress={() => setReceivedValue(total.toFixed(2))} />
              {BILLS.filter((bill) => bill >= total).slice(0, 3).map((bill) => <Chip key={bill} label={`S/ ${bill}`} active={receivedAmount === bill} onPress={() => setReceivedValue(String(bill))} />)}
            </View>
            <TextField label="Recibido (opcional)" value={received} onChangeText={setReceivedValue} keyboardType="decimal-pad" placeholder={total.toFixed(2)} />
            {change !== undefined ? <View style={[styles.change, change < -0.001 && styles.changeBad]}><Text style={styles.changeLabel}>{change >= -0.001 ? "VUELTO" : "FALTA"}</Text><Text style={styles.changeValue}>{money(Math.abs(change))}</Text></View> : null}
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.chargeBar}>
        <View style={styles.totalRow}><Text style={styles.totalLabel}>Total</Text><Text style={styles.totalValue}>{money(total)}</Text></View>
        <PrimaryButton label={busy ? "PROCESANDO…" : online ? `COBRAR ${money(total)}` : `GUARDAR VENTA ${money(total)}`} onPress={() => void charge()} disabled={busy || !draft.items.length} tone="success" />
        {!wide ? <Pressable onPress={() => setView("catalog")}><Text style={styles.back}>← Seguir agregando productos</Text></Pressable> : null}
      </View>
    </View>
  );

  return (
    <ResponsiveShell currentRoute="POSVenta" navigation={navigation} title="Vender" subtitle={wide ? "Toca los productos, elige cómo paga y cobra." : undefined} fill>
      {wide ? (
        <View style={styles.split}>{catalogPane}{ticketPane}</View>
      ) : view === "catalog" ? (
        <View style={{ flex: 1 }}>
          {catalogPane}
          {draft.items.length ? (
            <Pressable accessibilityRole="button" onPress={() => setView("ticket")} style={styles.cartBar}>
              <Text style={styles.cartBarText}>🛒 {count} · Ver ticket</Text>
              <Text style={styles.cartBarTotal}>{money(total)}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : ticketPane}
    </ResponsiveShell>
  );
}

const styles = StyleSheet.create({
  split: { flex: 1, flexDirection: "row", gap: 16 },
  pane: { flex: 1, gap: 10, minWidth: 0 },
  searchRow: { flexDirection: "row", gap: 8 },
  search: { flex: 1, minHeight: 48, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 14, paddingHorizontal: 14, backgroundColor: theme.colors.surface, color: theme.colors.text, fontSize: 16 },
  quickBtn: { minHeight: 48, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1.5, borderColor: theme.colors.primary, justifyContent: "center", backgroundColor: theme.colors.surface },
  quickBtnText: { color: theme.colors.primaryText, fontWeight: "900" },
  quickBox: { backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 16, padding: 14, gap: 10 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, paddingBottom: 90 },
  tile: { width: "31.5%", minWidth: 120, flexGrow: 1, minHeight: 104, padding: 12, borderRadius: 16, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface, justifyContent: "space-between" },
  tileHover: { borderColor: theme.colors.primary, backgroundColor: theme.colors.hover },
  tileActive: { borderColor: theme.colors.primary, backgroundColor: theme.colors.primarySoft },
  tileName: { color: theme.colors.text, fontWeight: "800", paddingRight: 22 },
  tilePrice: { color: theme.colors.primaryText, fontWeight: "900", fontSize: 16 },
  stock: { color: theme.colors.muted, fontSize: 11.5, marginTop: 2, fontWeight: "700" },
  badge: { position: "absolute", top: 8, right: 8, minWidth: 22, height: 22, borderRadius: 11, backgroundColor: theme.colors.primary, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 },
  badgeText: { color: "white", fontWeight: "900", fontSize: 12 },
  tileNew: { borderStyle: "dashed", alignItems: "center", justifyContent: "center", backgroundColor: "transparent" },
  tileNewPlus: { color: theme.colors.primaryText, fontSize: 24, fontWeight: "900" },
  tileNewText: { color: theme.colors.primaryText, fontWeight: "800", marginTop: 2 },
  ticket: { flex: 1, backgroundColor: theme.colors.surface, borderRadius: 18, borderWidth: 1, borderColor: theme.colors.border, overflow: "hidden" },
  ticketWide: { flexGrow: 0, flexShrink: 0, flexBasis: 420, width: 420 },
  ticketBody: { padding: 16, gap: 10 },
  ticketHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  ticketTitle: { color: theme.colors.text, fontWeight: "900", fontSize: 17 },
  clear: { color: theme.colors.danger, fontWeight: "800" },
  empty: { color: theme.colors.muted, paddingVertical: 18, textAlign: "center" },
  line: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border },
  lineName: { color: theme.colors.text, fontWeight: "800" },
  lineSub: { color: theme.colors.muted, fontSize: 12 },
  stepper: { flexDirection: "row", alignItems: "center", gap: 4 },
  stepBtn: { width: 32, height: 32, borderRadius: 10, backgroundColor: theme.colors.primarySoft, alignItems: "center", justifyContent: "center" },
  stepText: { color: theme.colors.primaryText, fontWeight: "900", fontSize: 16 },
  qty: { minWidth: 24, textAlign: "center", fontWeight: "900", color: theme.colors.text },
  lineTotal: { minWidth: 68, textAlign: "right", fontWeight: "900", color: theme.colors.text },
  remove: { color: theme.colors.danger, fontSize: 22, fontWeight: "900", paddingHorizontal: 4 },
  sectionLabel: { color: theme.colors.muted, fontWeight: "900", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6, marginTop: 8 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  hint: { color: theme.colors.warning, fontWeight: "700", lineHeight: 19 },
  change: { flexDirection: "row", justifyContent: "space-between", padding: 12, borderRadius: 12, backgroundColor: theme.colors.successSoft },
  changeBad: { backgroundColor: theme.colors.dangerSoft },
  changeLabel: { fontWeight: "900", color: theme.colors.text },
  changeValue: { fontWeight: "900", color: theme.colors.text, fontSize: 18 },
  chargeBar: { padding: 14, gap: 10, borderTopWidth: 1, borderTopColor: theme.colors.border, backgroundColor: theme.colors.surface },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  totalLabel: { color: theme.colors.muted, fontWeight: "800" },
  totalValue: { color: theme.colors.text, fontWeight: "900", fontSize: 28, letterSpacing: -0.5 },
  back: { color: theme.colors.primaryText, fontWeight: "800", textAlign: "center", paddingVertical: 4 },
  cartBar: { position: "absolute", left: 0, right: 0, bottom: 8, minHeight: 56, borderRadius: 16, backgroundColor: theme.colors.primary, paddingHorizontal: 18, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cartBarText: { color: "white", fontWeight: "900", fontSize: 16 },
  cartBarTotal: { color: "white", fontWeight: "900", fontSize: 20 }
});
