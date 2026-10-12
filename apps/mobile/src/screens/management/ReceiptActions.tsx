import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Card, Chip, InfoRow, PrimaryButton, SectionTitle, TextField } from "../../components/Ui";
import { showAlert } from "../../components/platform";
import {
  CREDIT_NOTE_OPTIONS,
  DEBIT_NOTE_OPTIONS,
  createCreditNote,
  createDebitNote,
  newTransactionId,
  refreshVoiding,
  requestBaja,
  type CreditNoteCode,
  type DebitNoteCode,
  type RemoteReceipt
} from "../../services/api";
import { theme } from "../../theme";

type Action = "CREDIT" | "BAJA" | "DEBIT";

const money = (value: number) => `S/ ${value.toFixed(2)}`;
const statusLabel = (status?: string) => ({ ACEPTADO: "Aceptada", ACCEPTED: "Aceptada", RECHAZADO: "Rechazada", REJECTED: "Rechazada", ERROR: "Revisar" } as Record<string, string>)[status ?? ""] ?? "En proceso";

/**
 * Corregir o anular una venta aceptada:
 * - Nota de crédito: anulación total, devolución de productos, descuento, error de RUC.
 * - Dar de baja: solo si el comprobante no se entregó y dentro del plazo de SUNAT.
 * - Nota de débito: cargos adicionales (intereses, aumento de valor, penalidad).
 */
export function ReceiptActions({ receipt, online, onChanged }: { receipt: RemoteReceipt; online: boolean; onChanged: (message: string) => Promise<void> }) {
  const [action, setAction] = useState<Action>();
  const [creditCode, setCreditCode] = useState<CreditNoteCode>("01");
  const [debitCode, setDebitCode] = useState<DebitNoteCode>("01");
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("");
  const [concept, setConcept] = useState("");
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [busy, setBusy] = useState(false);
  // Una clave por intento: si el usuario toca dos veces, no se duplica la nota.
  const [transactionId, setTransactionId] = useState(() => newTransactionId("nota"));

  const isFactura = receipt.documentType === "FACTURA";
  const creditOptions = CREDIT_NOTE_OPTIONS.filter((option) => (option.code !== "02" || isFactura) && option.code !== "06");
  const balance = receipt.creditableBalance ?? receipt.total;
  const hasCredits = (receipt.creditedTotal ?? 0) > 0;
  const canVoidByBaja = (receipt.voidingBlockers ?? ["?"]).length === 0;
  const voiding = receipt.voiding && receipt.voiding.status !== "RECHAZADO" ? receipt.voiding : undefined;
  const returnTotal = useMemo(
    () => (receipt.items ?? []).reduce((sum, item, index) => sum + (quantities[index] ?? 0) * item.unitPrice, 0),
    [quantities, receipt.items]
  );

  if (receipt.documentType === "NOTA_CREDITO" || receipt.documentType === "NOTA_DEBITO") return null;

  function reset(next?: Action) {
    setAction(next);
    setReason("");
    setAmount("");
    setConcept("");
    setQuantities({});
    setTransactionId(newTransactionId("nota"));
  }

  async function run(task: () => Promise<string>) {
    setBusy(true);
    try {
      const message = await task();
      reset();
      await onChanged(message);
    } catch (cause) {
      showAlert("No pudimos completar la operación", cause instanceof Error ? cause.message : "Intenta nuevamente.");
    } finally {
      setBusy(false);
    }
  }

  const practice = Boolean(receipt.practice);
  const noteMessage = (note: RemoteReceipt, what: string) => note.status === "ACCEPTED"
    ? practice
      ? `${what} ${note.officialNumber ?? ""} registrada en modo práctica (sin validez ante SUNAT).`
      : `${what} ${note.officialNumber ?? ""} aceptada por SUNAT.`
    : note.status === "REJECTED"
      ? `${what} rechazada: ${note.message ?? "revisa los datos"}.`
      : `${what} en proceso; FAKTU la confirmará automáticamente.`;

  function submitCredit() {
    if (reason.trim().length < 3 && creditCode !== "07") return showAlert("Falta el motivo", "Escribe brevemente por qué se emite la nota.");
    if (creditCode === "07") {
      const items = Object.entries(quantities).filter(([, qty]) => qty > 0).map(([index, quantity]) => ({ lineIndex: Number(index), quantity }));
      if (!items.length) return showAlert("Elige los productos", "Indica cuántas unidades de cada producto se devuelven.");
      return run(async () => noteMessage(await createCreditNote(receipt.id, { reasonCode: "07", description: reason.trim() || "DEVOLUCION DE PRODUCTOS", items, clientTransactionId: transactionId }), "Nota de crédito"));
    }
    if (creditCode === "09") {
      const value = Number(amount.replace(",", "."));
      if (!(value > 0) || value > balance) return showAlert("Monto inválido", `El descuento debe ser mayor a 0 y como máximo ${money(balance)}.`);
      return run(async () => noteMessage(await createCreditNote(receipt.id, { reasonCode: "09", description: reason.trim(), amount: value, clientTransactionId: transactionId }), "Nota de crédito"));
    }
    return run(async () => noteMessage(await createCreditNote(receipt.id, { reasonCode: creditCode, description: reason.trim() }), "Nota de crédito"));
  }

  function submitDebit() {
    const value = Number(amount.replace(",", "."));
    if (!concept.trim()) return showAlert("Falta el concepto", "Describe el cargo adicional.");
    if (!(value > 0)) return showAlert("Monto inválido", "Indica el monto del cargo (con IGV).");
    return run(async () => noteMessage(await createDebitNote(receipt.id, { reasonCode: debitCode, description: reason.trim() || undefined, items: [{ name: concept.trim(), quantity: 1, unitPrice: value }], clientTransactionId: transactionId }), "Nota de débito"));
  }

  function submitBaja() {
    if (reason.trim().length < 3) return showAlert("Falta el motivo", "Escribe el motivo de la baja.");
    return run(async () => {
      const result = await requestBaja(receipt.id, reason.trim());
      return result.status === "ACCEPTED" ? (practice ? "Baja registrada en modo práctica (sin validez ante SUNAT)." : "Comprobante dado de baja ante SUNAT.") : result.status === "REJECTED" ? `SUNAT rechazó la baja: ${result.message ?? ""}` : "Baja enviada. SUNAT la confirma en unos minutos; FAKTU lo revisará automáticamente.";
    });
  }

  if (voiding) {
    return <Card tone={voiding.status === "ACEPTADO" ? "default" : "warning"}>
      <InfoRow label={voiding.kind === "RESUMEN_BAJA" ? "Baja (resumen diario)" : "Comunicación de baja"} value={statusLabel(voiding.status)} />
      {voiding.status !== "ACEPTADO" ? <PrimaryButton label={busy ? "CONSULTANDO..." : "CONSULTAR ESTADO EN SUNAT"} tone="outline" disabled={busy || !online} onPress={() => void run(async () => {
        const result = await refreshVoiding(voiding.id);
        return result.status === "ACCEPTED" ? "La baja fue aceptada por SUNAT." : result.status === "REJECTED" ? `SUNAT rechazó la baja: ${result.message ?? ""}` : "SUNAT aún no confirma la baja.";
      })} /> : null}
    </Card>;
  }

  if (receipt.status !== "ACCEPTED" || receipt.voided) return null;

  return <View style={styles.wrap}>
    <SectionTitle>Corregir o anular</SectionTitle>
    {hasCredits || (receipt.debitedTotal ?? 0) > 0 ? <Card>
      {hasCredits ? <InfoRow label="Ya acreditado" value={`−${money(receipt.creditedTotal ?? 0)}`} /> : null}
      {(receipt.debitedTotal ?? 0) > 0 ? <InfoRow label="Cargos adicionales" value={money(receipt.debitedTotal ?? 0)} /> : null}
      <InfoRow label="Saldo" value={money(balance)} />
    </Card> : null}
    <View style={styles.chips}>
      <Chip label="Nota de crédito" active={action === "CREDIT"} onPress={() => reset(action === "CREDIT" ? undefined : "CREDIT")} />
      {canVoidByBaja ? <Chip label="Dar de baja" active={action === "BAJA"} onPress={() => reset(action === "BAJA" ? undefined : "BAJA")} /> : null}
      <Chip label="Nota de débito" active={action === "DEBIT"} onPress={() => reset(action === "DEBIT" ? undefined : "DEBIT")} />
    </View>

    {action === "CREDIT" ? <Card tone="warning">
      <View style={styles.chips}>
        {creditOptions.filter((option) => !hasCredits || option.code === "07" || option.code === "09").map((option) => (
          <Chip key={option.code} label={option.label} active={creditCode === option.code} onPress={() => { setCreditCode(option.code); setQuantities({}); }} />
        ))}
      </View>
      {creditCode === "07" ? <>
        <Text style={styles.help}>Indica cuántas unidades devuelve el cliente:</Text>
        {(receipt.items ?? []).map((item, index) => (
          <View key={`${item.id}-${index}`} style={styles.qtyRow}>
            <Text style={styles.qtyName}>{item.name} (vendido: {item.quantity})</Text>
            <Chip label="−" onPress={() => setQuantities((q) => ({ ...q, [index]: Math.max(0, (q[index] ?? 0) - 1) }))} />
            <Text style={styles.qtyValue}>{quantities[index] ?? 0}</Text>
            <Chip label="+" onPress={() => setQuantities((q) => ({ ...q, [index]: Math.min(item.quantity, (q[index] ?? 0) + 1) }))} />
          </View>
        ))}
        <InfoRow label="Total a devolver" value={money(returnTotal)} />
      </> : null}
      {creditCode === "09" ? <TextField label={`Monto a rebajar (máx. ${money(balance)})`} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="5.00" /> : null}
      <TextField label="Motivo" value={reason} onChangeText={setReason} placeholder={creditCode === "07" ? "Ej. Producto defectuoso" : "Ej. El cliente devolvió la compra"} />
      {creditCode === "01" || creditCode === "02" ? <Text style={styles.help}>Se emitirá una nota de crédito por {money(receipt.total)} que anula la venta ante SUNAT. No se puede deshacer.</Text> : null}
      <PrimaryButton label={busy ? "EMITIENDO..." : "EMITIR NOTA DE CRÉDITO"} onPress={() => void submitCredit()} disabled={busy || !online} />
    </Card> : null}

    {action === "BAJA" ? <Card tone="warning">
      <Text style={styles.help}>Usa la baja solo si el comprobante NO se entregó al cliente. SUNAT la confirma en unos minutos. Si ya lo entregaste, emite una nota de crédito.</Text>
      <TextField label="Motivo" value={reason} onChangeText={setReason} placeholder="Ej. Venta registrada por error" />
      <PrimaryButton label={busy ? "ENVIANDO..." : "DAR DE BAJA"} onPress={() => void submitBaja()} disabled={busy || !online} />
    </Card> : null}

    {action === "DEBIT" ? <Card tone="info">
      <View style={styles.chips}>
        {DEBIT_NOTE_OPTIONS.map((option) => <Chip key={option.code} label={option.label} active={debitCode === option.code} onPress={() => setDebitCode(option.code)} />)}
      </View>
      <TextField label="Concepto" value={concept} onChangeText={setConcept} placeholder="Ej. Intereses por pago tardío" />
      <TextField label="Monto con IGV" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="10.00" />
      <TextField label="Detalle (opcional)" value={reason} onChangeText={setReason} placeholder="Sustento para el cliente" />
      <PrimaryButton label={busy ? "EMITIENDO..." : "EMITIR NOTA DE DÉBITO"} onPress={() => void submitDebit()} disabled={busy || !online} />
    </Card> : null}

    {!canVoidByBaja && receipt.voidingBlockers?.length ? <Text style={styles.help}>Baja no disponible: {receipt.voidingBlockers.join(" ")}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  help: { color: theme.colors.muted, lineHeight: 20 },
  qtyRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  qtyName: { flex: 1, color: theme.colors.text },
  qtyValue: { minWidth: 24, textAlign: "center", fontWeight: "800", color: theme.colors.text }
});
