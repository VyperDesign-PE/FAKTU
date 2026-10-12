import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Linking, StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/types";
import { Screen } from "../../components/Screen";
import { Card, Chip, InfoRow, PrimaryButton, SectionTitle } from "../../components/Ui";
import { useApp } from "../../context/AppContext";
import { PAYMENT_METHODS } from "../../domain/types";
import { createSalesRegisterLink, getDailyClose, type DailyClose } from "../../services/api";
import { theme } from "../../theme";
import { showAlert } from "../../components/platform";

type P<Name extends keyof RootStackParamList> = NativeStackScreenProps<RootStackParamList, Name>;

/** Fecha de hoy en Lima (UTC-5, sin horario de verano). */
function limaToday() {
  return new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 10);
}

function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function friendlyDate(date: string) {
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
}

const money = (value: number) => `S/ ${value.toFixed(2)}`;
const methodLabel = (method: string) => PAYMENT_METHODS.find((m) => m.value === method)?.label ?? method;

export function CashCloseScreen(_props: P<"CashClose">) {
  const { online } = useApp();
  const [date, setDate] = useState(limaToday());
  const [report, setReport] = useState<DailyClose>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    if (!online) {
      setError("Necesitas Internet para ver el cierre de caja.");
      return;
    }
    setLoading(true);
    setError(undefined);
    try {
      setReport(await getDailyClose(date));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No pudimos cargar el cierre de caja.");
    } finally {
      setLoading(false);
    }
  }, [date, online]);

  useEffect(() => { void load(); }, [load]);

  async function exportMonth() {
    setExporting(true);
    try {
      const { url } = await createSalesRegisterLink(date.slice(0, 7));
      await Linking.openURL(url);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "No pudimos generar el archivo.";
      showAlert("Exportar ventas", message);
    } finally {
      setExporting(false);
    }
  }

  const isToday = date === limaToday();

  return <Screen title="Cierre de caja" subtitle={`${isToday ? "Hoy" : "Día"} ${friendlyDate(date)}`}>
    <View style={styles.chips}>
      <Chip label="‹ Día anterior" onPress={() => setDate(shiftDate(date, -1))} />
      <Chip label="Hoy" active={isToday} onPress={() => setDate(limaToday())} />
      {!isToday ? <Chip label="Día siguiente ›" onPress={() => setDate(shiftDate(date, 1))} /> : null}
    </View>

    {loading ? <ActivityIndicator color={theme.colors.primary} /> : null}
    {error ? <Card tone="danger"><Text>{error}</Text></Card> : null}

    {report ? <>
      <Card tone="success">
        <Text style={styles.big}>{money(report.netTotal)}</Text>
        <Text style={styles.muted}>Ventas netas del día ({report.sales.count} {report.sales.count === 1 ? "venta" : "ventas"})</Text>
      </Card>

      <Card tone="info">
        <InfoRow label="Efectivo esperado en caja" value={money(report.expectedCash)} />
        <Text style={styles.muted}>Sin contar el fondo inicial. Compáralo con el dinero contado.</Text>
      </Card>

      <SectionTitle>Por medio de pago</SectionTitle>
      <Card>
        {report.paymentMethods.length
          ? report.paymentMethods.map((row) => <InfoRow key={row.method} label={`${methodLabel(row.method)} (${row.salesCount})`} value={row.refunds ? `${money(row.net)}  (−${row.refunds.toFixed(2)})` : money(row.net)} />)
          : <Text style={styles.muted}>Todavía no hay ventas este día.</Text>}
      </Card>

      <SectionTitle>Comprobantes</SectionTitle>
      <Card>
        <InfoRow label={`Boletas (${report.byDocumentType.BOLETA.count})`} value={money(report.byDocumentType.BOLETA.total)} />
        <InfoRow label={`Facturas (${report.byDocumentType.FACTURA.count})`} value={money(report.byDocumentType.FACTURA.total)} />
        <InfoRow label={`Anulaciones (${report.creditNotes.count})`} value={`−${money(report.creditNotes.total)}`} />
      </Card>

      {report.pending.count ? <Card tone="warning"><InfoRow label={`Pendientes de SUNAT (${report.pending.count})`} value={money(report.pending.total)} /><Text style={styles.muted}>Ya cobradas; FAKTU sigue confirmándolas automáticamente.</Text></Card> : null}
      {report.rejected.count ? <Card tone="danger"><InfoRow label={`Rechazadas (${report.rejected.count})`} value={money(report.rejected.total)} /><Text style={styles.muted}>No cuentan como venta. Revísalas en el historial.</Text></Card> : null}
    </> : null}

    <PrimaryButton label="ACTUALIZAR" onPress={() => void load()} tone="outline" disabled={loading} />
    <SectionTitle>Para tu contador</SectionTitle>
    <Card><Text style={styles.muted}>Descarga el registro de ventas de {date.slice(5, 7)}/{date.slice(0, 4)} en formato CSV (se abre en Excel). Incluye boletas, facturas y notas de crédito.</Text></Card>
    <PrimaryButton label={exporting ? "GENERANDO..." : "DESCARGAR REGISTRO DEL MES"} onPress={() => void exportMonth()} disabled={exporting || !online} />
  </Screen>;
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  big: { fontSize: 32, fontWeight: "900", color: theme.colors.text },
  muted: { color: theme.colors.muted, lineHeight: 20 }
});
