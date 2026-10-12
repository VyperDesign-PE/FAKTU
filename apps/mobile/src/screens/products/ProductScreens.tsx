import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/types";
import { ResponsiveShell } from "../../components/ResponsiveShell";
import { Screen } from "../../components/Screen";
import { Card, Chip, InfoRow, PrimaryButton, SectionTitle, TextField } from "../../components/Ui";
import { showAlert } from "../../components/platform";
import { useApp } from "../../context/AppContext";
import type { Product } from "../../domain/types";
import { adjustRemoteStock, listStockMovements, upsertRemoteProduct, type StockMovement } from "../../services/api";
import { theme } from "../../theme";
import { stockLabel } from "../pos/PosScreen";

type P<Name extends keyof RootStackParamList> = NativeStackScreenProps<RootStackParamList, Name>;
const REASONS: Record<string, string> = { INICIAL: "Stock inicial", VENTA: "Venta", DEVOLUCION: "Devolución", INGRESO: "Ingreso de mercadería", AJUSTE: "Conteo / ajuste" };

export function ProductosScreen({ navigation }: P<"Productos">) {
  const { catalog, refreshCatalog, online } = useApp();
  const [search, setSearch] = useState("");
  const [onlyLow, setOnlyLow] = useState(false);
  useEffect(() => { if (online) void refreshCatalog(); }, [online, refreshCatalog]);

  const low = catalog.filter((p) => { const s = stockLabel(p); return s && s.tone !== "ok"; });
  const list = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (onlyLow ? low : catalog).filter((p) => !term || p.name.toLowerCase().includes(term)).sort((a, b) => a.name.localeCompare(b.name));
  }, [catalog, low, onlyLow, search]);

  return (
    <ResponsiveShell
      currentRoute="Productos"
      navigation={navigation}
      title="Productos y stock"
      subtitle="Tu catálogo para vender rápido. Activa el control de stock y FAKTU descuenta solo cada venta."
      action={<View style={{ width: 150 }}><PrimaryButton label="＋ NUEVO" onPress={() => navigation.navigate("ProductForm")} /></View>}
    >
      <View style={styles.toolbar}>
        <TextInput value={search} onChangeText={setSearch} placeholder="Buscar producto…" placeholderTextColor="#9AA1B1" style={styles.search} accessibilityLabel="Buscar producto" />
        <Chip label={`Stock bajo (${low.length})`} active={onlyLow} onPress={() => setOnlyLow((v) => !v)} />
      </View>
      {!list.length ? <Card><Text style={styles.muted}>{catalog.length ? "No hay productos con ese filtro." : "Aún no tienes productos. Agrega el primero o vende con “＋ Otro” desde Vender."}</Text></Card> : null}
      <View style={styles.table}>
        {list.map((product) => {
          const stock = stockLabel(product);
          return (
            <Pressable key={product.id} accessibilityRole="button" onPress={() => navigation.navigate("ProductForm", { productId: product.id })} style={({ hovered }: { pressed: boolean; hovered?: boolean }) => [styles.row, hovered && { backgroundColor: "#FBF9FF" }]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>{product.favorite ? "★ " : ""}{product.name}</Text>
                <Text style={styles.muted}>S/ {product.unitPrice.toFixed(2)}</Text>
              </View>
              {stock ? (
                <View style={[styles.pill, stock.tone === "danger" && styles.pillDanger, stock.tone === "warning" && styles.pillWarn]}>
                  <Text style={[styles.pillText, stock.tone === "danger" && { color: theme.colors.danger }, stock.tone === "warning" && { color: theme.colors.warning }]}>{stock.text}</Text>
                </View>
              ) : <Text style={styles.muted}>Sin control</Text>}
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          );
        })}
      </View>
    </ResponsiveShell>
  );
}

export function ProductFormScreen({ navigation, route }: P<"ProductForm">) {
  const { catalog, addProductToCatalog, removeProductFromCatalog, refreshCatalog, online } = useApp();
  const existing = route.params?.productId ? catalog.find((p) => p.id === route.params?.productId) : undefined;
  const [name, setName] = useState(existing?.name ?? "");
  const [price, setPrice] = useState(existing ? existing.unitPrice.toFixed(2) : "");
  const [favorite, setFavorite] = useState(existing?.favorite ?? true);
  const tracked = existing ? existing.stockQty !== null && existing.stockQty !== undefined : false;
  const [track, setTrack] = useState(tracked);
  const [stock, setStock] = useState("");
  const [minStock, setMinStock] = useState(String(existing?.minStock ?? 0));
  const [moves, setMoves] = useState<StockMovement[]>([]);
  const [busy, setBusy] = useState(false);
  const stockLine = existing ? stockLabel(existing) : undefined;

  useEffect(() => {
    if (existing && tracked && online) listStockMovements(existing.id).then(setMoves).catch(() => undefined);
  }, [existing, tracked, online]);

  async function save() {
    const amount = Number(price.replace(",", "."));
    const min = Number(minStock.replace(",", ".") || "0");
    if (!name.trim() || !Number.isFinite(amount) || amount < 0) return showAlert("Revisa los datos", "Escribe el nombre y un precio válido.");
    if (!Number.isFinite(min) || min < 0) return showAlert("Stock mínimo", "Ingresa un número válido.");
    const qty = stock.trim() ? Number(stock.replace(",", ".")) : undefined;
    if (qty !== undefined && !Number.isFinite(qty)) return showAlert("Stock", "Ingresa una cantidad válida.");
    if (track && !tracked && qty === undefined) return showAlert("Stock inicial", "¿Cuántas unidades tienes ahora? Escribe el stock actual.");
    if ((track || tracked) && !online) return showAlert("Necesitas Internet", "El stock se guarda en el servidor para que todas tus cajas lo vean igual. Intenta con conexión.");
    const product: Product = { id: existing?.id ?? `product-${Date.now()}`, name: name.trim(), unitPrice: amount, unit: existing?.unit ?? "NIU", favorite, minStock: min };
    setBusy(true);
    try {
      await addProductToCatalog({ ...product, stockQty: existing?.stockQty ?? null });
      if (track && qty !== undefined) {
        await upsertRemoteProduct(product);
        // Producto con control: el valor escrito es el stock actual (conteo) o lo que ingresa si ya lo controlaba.
        await adjustRemoteStock(product.id, tracked ? "ADD" : "SET", tracked ? qty : qty, tracked ? "Ingreso de mercadería" : "Stock inicial");
      } else if (tracked && !track) {
        showAlert("Control de stock", "Por ahora el stock queda activo en este producto; para dejar de controlarlo, bórralo y créalo de nuevo.");
      }
      await refreshCatalog();
      navigation.goBack();
    } catch (error) {
      showAlert("No pudimos guardar", error instanceof Error ? error.message : "Intenta nuevamente.");
    } finally {
      setBusy(false);
    }
  }

  async function count() {
    const qty = Number(stock.replace(",", "."));
    if (!existing || !stock.trim() || !Number.isFinite(qty) || qty < 0) return showAlert("Conteo", "Escribe cuántas unidades hay realmente.");
    setBusy(true);
    try {
      await adjustRemoteStock(existing.id, "SET", qty, "Conteo físico");
      await refreshCatalog();
      navigation.goBack();
    } catch (error) {
      showAlert("No pudimos ajustar", error instanceof Error ? error.message : "Intenta nuevamente.");
    } finally { setBusy(false); }
  }

  async function remove() {
    if (!existing) return;
    try { await removeProductFromCatalog(existing.id); navigation.goBack(); }
    catch (error) { showAlert("No pudimos eliminar", error instanceof Error ? error.message : "Intenta nuevamente."); }
  }

  return <Screen title={existing ? "Editar producto" : "Nuevo producto"} subtitle="Nombre y precio bastan para vender. El stock es opcional.">
    <TextField label="Nombre" value={name} onChangeText={setName} placeholder="Ej. Gaseosa 500 ml" />
    <TextField label="Precio de venta (S/, IGV incluido)" value={price} onChangeText={setPrice} keyboardType="decimal-pad" placeholder="3.00" />
    <View style={styles.chips}>
      <Chip label={favorite ? "★ Aparece primero al vender" : "☆ Marcar como favorito"} active={favorite} onPress={() => setFavorite((v) => !v)} />
    </View>

    <SectionTitle>Control de stock</SectionTitle>
    {existing && tracked ? <Card tone={stockLine?.tone === "danger" ? "danger" : stockLine?.tone === "warning" ? "warning" : "success"}><InfoRow label="Stock actual" value={String(existing.stockQty)} /></Card> : null}
    <View style={styles.chips}>
      <Chip label="No controlar" active={!track} onPress={() => !tracked && setTrack(false)} />
      <Chip label="Controlar stock" active={track} onPress={() => setTrack(true)} />
    </View>
    {track ? <>
      <TextField label={tracked ? "Ingreso de mercadería (+ unidades) o conteo real" : "Stock actual (unidades)"} value={stock} onChangeText={setStock} keyboardType="decimal-pad" placeholder={tracked ? "Ej. 24" : "Ej. 50"} />
      <TextField label="Avísame cuando queden (stock mínimo)" value={minStock} onChangeText={setMinStock} keyboardType="decimal-pad" placeholder="5" />
      {tracked ? <PrimaryButton label="FIJAR EL STOCK A ESTE CONTEO" onPress={() => void count()} tone="outline" disabled={busy} /> : null}
      <Text style={styles.muted}>Cada venta descuenta el stock y cada anulación o devolución lo repone. Nunca bloqueamos una venta por falta de stock.</Text>
    </> : null}
    <PrimaryButton label={busy ? "GUARDANDO…" : existing && tracked && track ? "GUARDAR E INGRESAR STOCK" : "GUARDAR PRODUCTO"} onPress={() => void save()} disabled={busy} />
    {existing ? <PrimaryButton label="ELIMINAR PRODUCTO" onPress={() => void remove()} tone="outline" /> : null}

    {moves.length ? <>
      <SectionTitle>Movimientos (kardex)</SectionTitle>
      <Card>{moves.slice(0, 12).map((move) => <InfoRow key={move.id} label={`${REASONS[move.reason] ?? move.reason} · ${new Date(move.createdAt).toLocaleDateString("es-PE")}`} value={`${move.delta > 0 ? "+" : ""}${move.delta} → ${move.balance}`} />)}</Card>
    </> : null}
  </Screen>;
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: "row", gap: 10, alignItems: "center", flexWrap: "wrap" },
  search: { flex: 1, minWidth: 200, minHeight: 46, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 14, paddingHorizontal: 14, backgroundColor: theme.colors.surface, color: theme.colors.text, fontSize: 16 },
  table: { backgroundColor: theme.colors.surface, borderRadius: 16, borderWidth: 1, borderColor: theme.colors.border, overflow: "hidden" },
  row: { minHeight: 62, paddingHorizontal: 16, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border },
  name: { color: theme.colors.text, fontWeight: "800", fontSize: 15 },
  muted: { color: theme.colors.muted, lineHeight: 20 },
  pill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: theme.colors.successSoft },
  pillDanger: { backgroundColor: theme.colors.dangerSoft },
  pillWarn: { backgroundColor: theme.colors.warningSoft },
  pillText: { color: theme.colors.success, fontWeight: "800", fontSize: 12 },
  chevron: { color: theme.colors.primary, fontWeight: "900", fontSize: 20 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 }
});
