import { useMemo, useState } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, Share, StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/types";
import { Screen } from "../../components/Screen";
import { Card, Chip, InfoRow, PrimaryButton, SectionTitle, TextField } from "../../components/Ui";
import { CustomerDocumentLookupField } from "../../components/customer/CustomerDocumentLookupField";
import { useApp } from "../../context/AppContext";
import type { Customer } from "../../domain/types";
import { createReceiptSharePackage, type ReceiptSharePackage } from "../../services/api";
import { theme } from "../../theme";

type P<Name extends keyof RootStackParamList> = NativeStackScreenProps<RootStackParamList, Name>;

function totalOf(items: { quantity: number; unitPrice: number }[]) {
  return items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
}

export function NewSaleScreen({ navigation }: P<"NewSale">) {
  const { catalog, draft, addItem, online } = useApp();
  const total = totalOf(draft.items);
  return <Screen title="Nueva venta" subtitle="Toca tus productos frecuentes o agrega un concepto.">
    {!online ? <Card tone="warning"><Text style={styles.warning}>Sin Internet. Puedes seguir vendiendo.</Text></Card> : null}
    <SectionTitle>Favoritos</SectionTitle>
    <View style={styles.productGrid}>{catalog.filter((p) => p.favorite).slice(0, 8).map((p) => <Pressable key={p.id} style={styles.productCard} onPress={() => addItem(p)}><Text style={styles.productName}>{p.name}</Text><Text style={styles.price}>S/ {p.unitPrice.toFixed(2)}</Text></Pressable>)}</View>
    <PrimaryButton label="+ AGREGAR PRODUCTO / SERVICIO" onPress={() => navigation.navigate("AddProduct")} tone="outline" />
    <PrimaryButton label="VENTA RÁPIDA / MANUAL" onPress={() => navigation.navigate("QuickSale")} tone="outline" />
    <Card><InfoRow label={`${draft.items.length} producto(s)`} value={`S/ ${total.toFixed(2)}`} /></Card>
    <PrimaryButton label="VER CARRITO" onPress={() => navigation.navigate("Cart")} disabled={!draft.items.length} />
  </Screen>;
}

export function AddProductScreen({ navigation }: P<"AddProduct">) {
  const { addProductToCatalog, addItem } = useApp();
  const [name, setName] = useState(""); const [price, setPrice] = useState(""); const [unit, setUnit] = useState("Unidad");
  async function save() {
    const amount = Number(price.replace(",", "."));
    if (!name.trim() || !Number.isFinite(amount) || amount < 0) return Alert.alert("Revisa los datos", "Ingresa nombre y precio válido.");
    const product = { id: `product-${Date.now()}`, name: name.trim(), unitPrice: amount, unit, favorite: true };
    await addProductToCatalog(product); addItem(product); navigation.navigate("NewSale");
  }
  return <Screen title="Agregar producto / servicio" subtitle="Solo nombre y precio son obligatorios.">
    <TextField label="Nombre del producto / servicio" value={name} onChangeText={setName} placeholder="Ej. Gaseosa 500 ml" />
    <TextField label="Precio de venta (S/)" value={price} onChangeText={setPrice} keyboardType="decimal-pad" placeholder="3.00" />
    <TextField label="Unidad" value={unit} onChangeText={setUnit} placeholder="Unidad" />
    <Card tone="info"><Text style={styles.muted}>Foto, categoría, código de barras e inventario quedan como opciones posteriores. No bloquean la venta.</Text></Card>
    <PrimaryButton label="GUARDAR PRODUCTO" onPress={save} />
  </Screen>;
}

export function QuickSaleScreen({ navigation }: P<"QuickSale">) {
  const { addItem } = useApp();
  const [concept, setConcept] = useState(""); const [amount, setAmount] = useState("");
  function add() {
    const price = Number(amount.replace(",", "."));
    if (!concept.trim() || !Number.isFinite(price) || price <= 0) return Alert.alert("Revisa los datos", "Ingresa concepto e importe.");
    addItem({ id: `manual-${Date.now()}`, name: concept.trim(), unitPrice: price, unit: "Servicio", favorite: false }); navigation.navigate("Cart");
  }
  return <Screen title="Venta rápida / manual" subtitle="Úsala para algo que no necesitas guardar en tu catálogo.">
    <TextField label="Concepto" value={concept} onChangeText={setConcept} placeholder="Ej. Reparación de puerta" />
    <TextField label="Importe (S/)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="80.00" />
    <PrimaryButton label="AGREGAR A LA VENTA" onPress={add} tone="success" />
  </Screen>;
}

export function CartScreen({ navigation }: P<"Cart">) {
  const { draft, setItemQuantity, removeItem } = useApp();
  const total = totalOf(draft.items);
  return <Screen title="Carrito de venta" subtitle="Modifica cantidades o elimina productos.">
    {draft.items.map((item) => <Card key={item.id}><View style={styles.cartRow}><View style={{ flex: 1 }}><Text style={styles.productName}>{item.name}</Text><Text style={styles.muted}>S/ {item.unitPrice.toFixed(2)} c/u</Text></View><View style={styles.qty}><Pressable onPress={() => setItemQuantity(item.id, item.quantity - 1)}><Text style={styles.qtyButton}>−</Text></Pressable><Text style={styles.qtyValue}>{item.quantity}</Text><Pressable onPress={() => setItemQuantity(item.id, item.quantity + 1)}><Text style={styles.qtyButton}>＋</Text></Pressable></View><Pressable onPress={() => removeItem(item.id)}><Text style={styles.delete}>×</Text></Pressable></View><InfoRow label="Subtotal" value={`S/ ${(item.quantity * item.unitPrice).toFixed(2)}`} /></Card>)}
    <PrimaryButton label="+ AGREGAR MÁS PRODUCTOS" onPress={() => navigation.navigate("NewSale")} tone="outline" />
    <Card tone="info"><InfoRow label="TOTAL" value={`S/ ${total.toFixed(2)}`} /></Card>
    <PrimaryButton label="CONTINUAR" onPress={() => navigation.navigate("DocumentType")} disabled={!draft.items.length} />
  </Screen>;
}

export function DocumentTypeScreen({ navigation }: P<"DocumentType">) {
  const { draft, setDocumentType } = useApp();
  return <Screen title="Tipo de comprobante" subtitle="¿Qué deseas emitir?">
    <Pressable onPress={() => setDocumentType("BOLETA")}><Card tone={draft.documentType === "BOLETA" ? "success" : "default"}><Text style={styles.docTitle}>BOLETA ELECTRÓNICA {draft.documentType === "BOLETA" ? "✓" : ""}</Text><Text>Para ventas al público.</Text></Card></Pressable>
    <Pressable onPress={() => setDocumentType("FACTURA")}><Card tone={draft.documentType === "FACTURA" ? "info" : "default"}><Text style={styles.docTitle}>FACTURA ELECTRÓNICA {draft.documentType === "FACTURA" ? "✓" : ""}</Text><Text>Para clientes con RUC.</Text></Card></Pressable>
    <Card><Text style={styles.muted}>Poner un RUC en una boleta no la convierte en factura.</Text></Card>
    <PrimaryButton label="CONTINUAR" onPress={() => navigation.navigate("CustomerData")} />
  </Screen>;
}

export function CustomerDataScreen({ navigation }: P<"CustomerData">) {
  const { draft, setCustomer, online } = useApp();
  const total = totalOf(draft.items);
  const mustIdentify = draft.documentType === "FACTURA" || total > 700;
  const [mode, setMode] = useState<"NONE" | "DNI" | "RUC">(draft.documentType === "FACTURA" ? "RUC" : "NONE");
  const [number, setNumber] = useState(draft.customer?.documentNumber ?? "");
  const [name, setName] = useState(draft.customer?.name ?? "");

  function changeMode(nextMode: "NONE" | "DNI" | "RUC") {
    if (draft.documentType === "FACTURA" && nextMode !== "RUC") {
      return Alert.alert("Factura con RUC", "Para emitir factura necesitamos identificar al cliente con RUC.");
    }
    setMode(nextMode);
    setNumber("");
    setName("");
  }

  function next() {
    if (mustIdentify && mode === "NONE") return Alert.alert("Identificación requerida", "Para esta operación necesitamos identificar al cliente.");
    if (draft.documentType === "FACTURA" && mode !== "RUC") return Alert.alert("Factura con RUC", "Para emitir factura selecciona RUC.");

    let customer: Customer | undefined;
    if (mode !== "NONE") {
      const expectedLength = mode === "DNI" ? 8 : 11;
      if (number.length !== expectedLength) return Alert.alert("Documento incompleto", mode === "DNI" ? "Ingresa los 8 dígitos del DNI." : "Ingresa los 11 dígitos del RUC.");
      if (!name.trim()) return Alert.alert("Falta el nombre", "Busca el documento o escribe el nombre manualmente.");
      customer = { documentType: mode, documentNumber: number, name: name.trim() };
    }

    setCustomer(customer);
    navigation.navigate("SaleSummary");
  }

  return <Screen title="Datos del cliente" subtitle={mustIdentify ? "Para esta operación necesitamos identificar al cliente." : "Puedes emitir sin datos cuando corresponda."}>
    <View style={styles.chips}>
      <Chip label="Sin datos" active={mode === "NONE"} onPress={() => changeMode("NONE")} />
      <Chip label="DNI" active={mode === "DNI"} onPress={() => changeMode("DNI")} />
      <Chip label="RUC" active={mode === "RUC"} onPress={() => changeMode("RUC")} />
    </View>

    {mode !== "NONE" ? (
      <CustomerDocumentLookupField
        tipoDoc={mode}
        numero={number}
        nombre={name}
        online={online}
        onNumeroChange={setNumber}
        onNombreChange={setName}
      />
    ) : null}

    {!online ? <Card tone="warning"><Text style={styles.warning}>Sin Internet: completa el nombre manualmente. La venta quedará guardada y se sincronizará cuando vuelva la conexión.</Text></Card> : null}
    <PrimaryButton label="CONTINUAR" onPress={next} />
  </Screen>;
}

export function SaleSummaryScreen({ navigation }: P<"SaleSummary">) {
  const { draft, createReceipt, online } = useApp();
  const total = totalOf(draft.items);
  const igv = total - total / 1.18;
  const base = total - igv;
  const [busy, setBusy] = useState(false);
  async function emit() {
    if (!draft.items.length) return Alert.alert("Venta vacía", "Agrega al menos un producto.");
    setBusy(true);
    try { await createReceipt(); navigation.replace(online ? "EmissionResult" : "TemporaryReceipt"); }
    finally { setBusy(false); }
  }
  return <Screen title="Resumen de la venta" subtitle="Revisa la información antes de emitir.">
    <Card tone="success"><Text style={styles.docTitle}>{draft.documentType}</Text>{draft.customer ? <><InfoRow label="Cliente" value={draft.customer.name ?? "-"} /><InfoRow label={draft.customer.documentType ?? "Documento"} value={draft.customer.documentNumber ?? "-"} /></> : <InfoRow label="Cliente" value="Público general" />}</Card>
    <Card>{draft.items.map((item) => <InfoRow key={item.id} label={`${item.name} × ${item.quantity}`} value={`S/ ${(item.quantity * item.unitPrice).toFixed(2)}`} />)}</Card>
    <Card><InfoRow label="Subtotal referencial" value={`S/ ${base.toFixed(2)}`} /><InfoRow label="IGV incluido (18%)" value={`S/ ${igv.toFixed(2)}`} /><InfoRow label="TOTAL A PAGAR" value={`S/ ${total.toFixed(2)}`} /></Card>
    <PrimaryButton label={busy ? "PROCESANDO..." : online ? "EMITIR" : "GUARDAR Y EMITIR AL VOLVER INTERNET"} onPress={emit} disabled={busy} />
  </Screen>;
}

export function EmissionResultScreen({ navigation }: P<"EmissionResult">) {
  const { lastReceipt, queue } = useApp();
  const current = queue.find((r) => r.clientTransactionId === lastReceipt?.clientTransactionId) ?? lastReceipt;
  const accepted = current?.status === "ACCEPTED";
  return <Screen title={accepted ? "¡Comprobante emitido!" : "Venta registrada"} subtitle={accepted ? "SUNAT/PSE aceptó el comprobante en este entorno de prueba." : "El comprobante se está procesando."}>
    <View style={styles.resultIcon}><Text style={styles.resultCheck}>{accepted ? "✓" : "…"}</Text></View>
    <Card tone={accepted ? "success" : "warning"}><InfoRow label="Número" value={current?.officialNumber ?? current?.temporaryNumber ?? "-"} /><InfoRow label="Total" value={`S/ ${(current?.total ?? 0).toFixed(2)}`} /><InfoRow label="Estado" value={accepted ? "Aceptado" : "Pendiente"} /></Card>
    <PrimaryButton label="COMPARTIR COMPROBANTE" onPress={() => navigation.navigate("ShareReceipt")} tone="success" />
    <PrimaryButton label="NUEVA VENTA" onPress={() => navigation.reset({ index: 1, routes: [{ name: "Dashboard" }, { name: "NewSale" }] })} tone="outline" />
  </Screen>;
}

export function ShareReceiptScreen({ navigation, route }: P<"ShareReceipt">) {
  const { lastReceipt, queue } = useApp();
  const requestedTransactionId = route.params?.clientTransactionId ?? lastReceipt?.clientTransactionId;
  const current = queue.find((r) => r.clientTransactionId === requestedTransactionId) ?? lastReceipt;
  const [channel, setChannel] = useState<string>();
  const [sharePackage, setSharePackage] = useState<ReceiptSharePackage>();
  const [busy, setBusy] = useState(false);
  const options = ["WhatsApp", "Enlace", "Correo", "Ver PDF"];

  async function ensurePackage() {
    if (sharePackage) return sharePackage;
    if (!requestedTransactionId) throw new Error("No encontramos el comprobante que deseas compartir.");
    const created = await createReceiptSharePackage(requestedTransactionId);
    setSharePackage(created);
    return created;
  }

  async function useChannel() {
    if (!channel) return;
    setBusy(true);
    try {
      const pack = await ensurePackage();
      if (channel === "WhatsApp") {
        const url = `https://wa.me/?text=${encodeURIComponent(pack.whatsappText)}`;
        await Linking.openURL(url);
        return;
      }
      if (channel === "Correo") {
        const url = `mailto:?subject=${encodeURIComponent(pack.emailSubject)}&body=${encodeURIComponent(pack.emailBody)}`;
        await Linking.openURL(url);
        return;
      }
      if (channel === "Ver PDF") {
        await Linking.openURL(pack.pdfUrl);
        return;
      }
      await Share.share({ message: pack.viewUrl });
    } catch (error) {
      Alert.alert("No pudimos compartir", error instanceof Error ? error.message : "Intenta nuevamente.");
    } finally {
      setBusy(false);
    }
  }

  return <Screen title="Compartir comprobante" subtitle="Elige cómo deseas entregarlo al cliente.">
    <Card tone="success"><InfoRow label="Comprobante" value={current?.officialNumber ?? current?.temporaryNumber ?? "-"} /><InfoRow label="Total" value={`S/ ${(current?.total ?? 0).toFixed(2)}`} /></Card>
    <View style={styles.shareGrid}>{options.map((option) => <Pressable key={option} style={[styles.shareCard, channel === option && styles.shareActive]} onPress={() => setChannel(option)}><Text style={styles.shareTitle}>{option}</Text></Pressable>)}</View>
    <Card tone="info"><Text style={styles.muted}>Los enlaces son temporales y firmados. El token del proveedor de facturación nunca viaja al cliente.</Text></Card>
    {busy ? <ActivityIndicator color={theme.colors.primary} /> : null}
    <PrimaryButton label={channel ? `USAR ${channel.toUpperCase()}` : "ELIGE UNA OPCIÓN"} onPress={() => void useChannel()} disabled={!channel || busy} />
    <PrimaryButton label="VOLVER AL INICIO" onPress={() => navigation.reset({ index: 0, routes: [{ name: "Dashboard" }] })} tone="outline" />
  </Screen>;
}

const styles = StyleSheet.create({
  productGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 }, productCard: { width: "31%", minHeight: 96, padding: 11, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: "white", justifyContent: "space-between" },
  productName: { color: theme.colors.text, fontWeight: "800" }, price: { color: theme.colors.primary, fontWeight: "900", marginTop: 8 }, muted: { color: theme.colors.muted, lineHeight: 20 }, warning: { color: theme.colors.warning, fontWeight: "800" },
  cartRow: { flexDirection: "row", alignItems: "center", gap: 10 }, qty: { flexDirection: "row", alignItems: "center", gap: 8 }, qtyButton: { color: theme.colors.primary, fontSize: 22, fontWeight: "900", padding: 5 }, qtyValue: { minWidth: 20, textAlign: "center", fontWeight: "900" }, delete: { color: theme.colors.danger, fontSize: 24, fontWeight: "900" },
  docTitle: { fontSize: 17, fontWeight: "900", color: theme.colors.text }, chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, resultIcon: { alignItems: "center", paddingVertical: 10 }, resultCheck: { width: 72, height: 72, borderRadius: 36, backgroundColor: theme.colors.success, color: "white", textAlign: "center", lineHeight: 72, fontSize: 42, fontWeight: "900" },
  shareGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 }, shareCard: { width: "48%", minHeight: 90, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: "white", borderRadius: 15, alignItems: "center", justifyContent: "center", padding: 12 }, shareActive: { borderColor: theme.colors.primary, backgroundColor: theme.colors.primarySoft }, shareTitle: { color: theme.colors.text, fontWeight: "900", textAlign: "center" }
});
