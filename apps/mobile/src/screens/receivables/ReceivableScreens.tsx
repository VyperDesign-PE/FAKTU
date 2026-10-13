import { useCallback, useEffect, useMemo, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/types";
import { ResponsiveShell } from "../../components/ResponsiveShell";
import { Card, Chip, PrimaryButton, TextField } from "../../components/Ui";
import { showAlert } from "../../components/platform";
import { useApp } from "../../context/AppContext";
import { SETTLEMENT_METHODS, type PaymentMethod } from "../../domain/types";
import { listReceivables, payReceivable, type Receivable } from "../../services/api";
import { theme } from "../../theme";

type Props = NativeStackScreenProps<RootStackParamList, "PorCobrar">;
const money = (value: number) => `S/ ${value.toFixed(2)}`;
const daysSince = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));

type Debtor = { key: string; name: string; document?: string; phone?: string; sales: Receivable[]; balance: number; oldest: number };

function group(items: Receivable[]): Debtor[] {
  const map = new Map<string, Debtor>();
  for (const item of items) {
    const key = item.customerDocument ?? item.customerName;
    const debtor = map.get(key) ?? { key, name: item.customerName, document: item.customerDocument, phone: item.customerPhone, sales: [], balance: 0, oldest: 0 };
    debtor.sales.push(item);
    debtor.balance = Math.round((debtor.balance + item.balance) * 100) / 100;
    debtor.oldest = Math.max(debtor.oldest, daysSince(item.issueDate));
    debtor.phone = debtor.phone ?? item.customerPhone;
    map.set(key, debtor);
  }
  return [...map.values()].sort((a, b) => b.oldest - a.oldest || b.balance - a.balance);
}

export function reminderUrl(debtor: Pick<Debtor, "name" | "phone" | "balance" | "sales">, business: string) {
  const digits = (debtor.phone ?? "").replace(/\D/g, "");
  const phone = digits.length === 9 ? `51${digits}` : digits;
  const first = debtor.name.split(" ")[0] ?? "";
  const text = `Hola ${first}, te saludo de ${business}. Tienes un saldo pendiente de ${money(debtor.balance)} (${debtor.sales.length} ${debtor.sales.length === 1 ? "compra" : "compras"}). Puedes pagarme por Yape o Plin cuando gustes. ¡Gracias!`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}

export function PorCobrarScreen({ navigation }: Props) {
  const { online, profile } = useApp();
  const [items, setItems] = useState<Receivable[]>();
  const [error, setError] = useState<string>();
  const load = useCallback(async () => {
    try { setItems(await listReceivables()); setError(undefined); } catch (e) { setError(e instanceof Error ? e.message : "No pudimos cargar."); }
  }, []);
  useEffect(() => { if (online) void load(); }, [load, online]);

  const debtors = useMemo(() => group(items ?? []), [items]);
  const total = debtors.reduce((sum, d) => sum + d.balance, 0);
  const business = profile.tradeName ?? profile.businessName ?? "mi negocio";

  return (
    <ResponsiveShell currentRoute="PorCobrar" navigation={navigation} title="Por cobrar" subtitle="Lo que tus clientes te deben (fiados). Cobra y recuérdales por WhatsApp.">
      {!online ? <Card tone="warning"><Text style={styles.warn}>Necesitas Internet para ver y cobrar fiados.</Text></Card> : null}
      {error ? <Card tone="danger"><Text>{error}</Text></Card> : null}
      <View style={styles.summary}>
        <View style={styles.sumCard}><Text style={styles.sumLabel}>Total por cobrar</Text><Text style={styles.sumValue}>{money(total)}</Text></View>
        <View style={styles.sumCard}><Text style={styles.sumLabel}>Clientes con deuda</Text><Text style={styles.sumValue}>{debtors.length}</Text></View>
        <View style={styles.sumCard}><Text style={styles.sumLabel}>Deuda más antigua</Text><Text style={styles.sumValue}>{debtors[0] ? `${debtors[0].oldest} d` : "—"}</Text></View>
      </View>
      {items && !debtors.length ? <Card tone="success"><Text style={styles.ok}>Nadie te debe nada. Para fiar, elige “Fiado” al cobrar en Vender.</Text></Card> : null}
      {debtors.map((debtor) => <DebtorCard key={debtor.key} debtor={debtor} business={business} onPaid={load} />)}
    </ResponsiveShell>
  );
}

function DebtorCard({ debtor, business, onPaid }: { debtor: Debtor; business: string; onPaid: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(debtor.balance.toFixed(2));
  const [method, setMethod] = useState<PaymentMethod>("EFECTIVO");
  const [busy, setBusy] = useState(false);

  async function pay() {
    let remaining = Math.round(Number(amount.replace(",", ".")) * 100) / 100;
    if (!Number.isFinite(remaining) || remaining <= 0) return showAlert("Monto", "Escribe cuánto te pagó.");
    if (remaining > debtor.balance + 0.004) return showAlert("Monto", `Solo debe ${money(debtor.balance)}.`);
    setBusy(true);
    try {
      // El pago cubre primero las deudas más antiguas.
      for (const sale of [...debtor.sales].sort((a, b) => a.issueDate.localeCompare(b.issueDate))) {
        if (remaining <= 0.004) break;
        const part = Math.min(remaining, sale.balance);
        await payReceivable(sale.receiptId, Math.round(part * 100) / 100, method);
        remaining = Math.round((remaining - part) * 100) / 100;
      }
      setOpen(false);
      await onPaid();
    } catch (error) {
      showAlert("No pudimos registrar el cobro", error instanceof Error ? error.message : "Intenta nuevamente.");
      await onPaid();
    } finally { setBusy(false); }
  }

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{debtor.name}</Text>
          <Text style={styles.sub}>{debtor.document ? `DNI ${debtor.document} · ` : ""}{debtor.sales.length} {debtor.sales.length === 1 ? "compra" : "compras"} · hace {debtor.oldest} {debtor.oldest === 1 ? "día" : "días"}</Text>
        </View>
        <Text style={[styles.balance, debtor.oldest > 30 && { color: theme.colors.danger }]}>{money(debtor.balance)}</Text>
      </View>
      <View style={styles.actions}>
        <View style={{ flex: 1 }}><PrimaryButton label="Registrar pago" onPress={() => setOpen((v) => !v)} tone="success" /></View>
        <View style={{ flex: 1 }}><PrimaryButton label="Recordar WhatsApp" onPress={() => void Linking.openURL(reminderUrl(debtor, business))} tone="outline" /></View>
      </View>
      {!debtor.phone ? <Text style={styles.sub}>Sin celular registrado: WhatsApp te dejará elegir el contacto.</Text> : null}
      {open ? (
        <View style={styles.pay}>
          <TextField label="¿Cuánto te pagó? (S/)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
          <View style={styles.chips}>{SETTLEMENT_METHODS.map((m) => <Chip key={m.value} label={m.label} active={method === m.value} onPress={() => setMethod(m.value)} />)}</View>
          <PrimaryButton label={busy ? "REGISTRANDO…" : "CONFIRMAR COBRO"} onPress={() => void pay()} disabled={busy} />
        </View>
      ) : null}
      {debtor.sales.map((sale) => (
        <View key={sale.receiptId} style={styles.sale}>
          <Text style={styles.saleText}>{sale.number} · {new Date(sale.issueDate).toLocaleDateString("es-PE")}</Text>
          <Text style={styles.saleText}>{sale.paid > 0 ? `${money(sale.balance)} de ${money(sale.total)}` : money(sale.total)}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  warn: { color: theme.colors.warning, fontWeight: "600" },
  ok: { color: theme.colors.success, fontWeight: "600" },
  summary: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  sumCard: { flexGrow: 1, flexBasis: 0, minWidth: 150, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, padding: 16 },
  sumLabel: { color: theme.colors.muted, fontWeight: "600" },
  sumValue: { color: theme.colors.text, fontWeight: "700", fontSize: 26, marginTop: 6 },
  card: { backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, padding: 16, gap: 12 },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  name: { color: theme.colors.text, fontWeight: "700", fontSize: 17 },
  sub: { color: theme.colors.muted, fontSize: 12.5, lineHeight: 18 },
  balance: { color: theme.colors.text, fontWeight: "700", fontSize: 22 },
  actions: { flexDirection: "row", gap: 10 },
  pay: { gap: 10, backgroundColor: theme.colors.hover, borderRadius: 10, padding: 12 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  sale: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border },
  saleText: { color: theme.colors.muted, fontSize: 13 }
});
