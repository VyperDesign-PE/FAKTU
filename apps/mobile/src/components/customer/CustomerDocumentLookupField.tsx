import { useEffect, useRef, useState } from "react";
import { DOCUMENT_LENGTH } from "../../domain/documentRules";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { consultarDocumentoCliente, type CustomerLookupResult } from "../../services/api";
import { theme } from "../../theme";

type Props = {
  tipoDoc: "DNI" | "RUC";
  numero: string;
  nombre: string;
  online: boolean;
  onNumeroChange: (value: string) => void;
  onNombreChange: (value: string) => void;
  onResolved?: (result: CustomerLookupResult) => void;
  autoLookup?: boolean;
};

const EXPECTED_LENGTH = DOCUMENT_LENGTH;

function sourceLabel(result?: CustomerLookupResult) {
  if (!result) return undefined;
  if (result.source === "MOCK") return "Datos simulados · modo de prueba";
  if (result.source === "CACHE_SERVER") return "Cliente encontrado en tu base de datos";
  if (result.source === "SUNAT_RUC_PADRON") {
    return result.sourceUpdatedAt
      ? `Datos oficiales SUNAT · padrón ${result.sourceUpdatedAt}`
      : "Datos oficiales del padrón SUNAT";
  }
  return "Datos encontrados";
}

export function CustomerDocumentLookupField({
  tipoDoc,
  numero,
  nombre,
  online,
  onNumeroChange,
  onNombreChange,
  onResolved,
  autoLookup = true
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [resolved, setResolved] = useState<CustomerLookupResult>();
  const requestId = useRef(0);
  const expectedLength = EXPECTED_LENGTH[tipoDoc];

  function updateNumber(value: string) {
    const clean = value.replace(/\D/g, "").slice(0, expectedLength);
    setError(undefined);
    setResolved(undefined);
    onNumeroChange(clean);
    if (clean !== numero) onNombreChange("");
  }

  async function search() {
    if (numero.length !== expectedLength) {
      setError(tipoDoc === "DNI" ? "Ingresa los 8 dígitos del DNI." : "Ingresa los 11 dígitos del RUC.");
      return;
    }

    if (!online) {
      setResolved(undefined);
      setError("Sin Internet. Puedes escribir el nombre manualmente y continuar.");
      return;
    }

    const id = ++requestId.current;
    setLoading(true);
    setError(undefined);
    setResolved(undefined);

    try {
      const result = await consultarDocumentoCliente(tipoDoc, numero);
      if (id !== requestId.current) return;
      onNombreChange(result.nombreCompleto);
      setResolved(result);
      onResolved?.(result);
    } catch (cause) {
      if (id !== requestId.current) return;
      setResolved(undefined);
      setError(cause instanceof Error ? cause.message : "No pudimos consultar el documento. Escribe el nombre manualmente.");
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }

  useEffect(() => {
    if (!autoLookup || numero.length !== expectedLength || !online) return;
    const timer = setTimeout(() => void search(), 350);
    return () => clearTimeout(timer);
    // search intentionally depends on the controlled values below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLookup, numero, tipoDoc, online]);

  const lookupLabel = sourceLabel(resolved);
  const isMock = resolved?.source === "MOCK";

  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>{tipoDoc}</Text>
      <View style={[styles.inputShell, error && styles.inputShellError]}>
        <TextInput
          accessibilityLabel={tipoDoc}
          value={numero}
          onChangeText={updateNumber}
          keyboardType="number-pad"
          maxLength={expectedLength}
          placeholder={tipoDoc === "DNI" ? "12345678" : "20123456789"}
          placeholderTextColor={theme.colors.muted}
          returnKeyType="search"
          onSubmitEditing={() => void search()}
          style={styles.documentInput}
        />
        {loading ? <ActivityIndicator accessibilityLabel="Buscando cliente" size="small" color={theme.colors.primary} /> : null}
      </View>

      <View style={styles.lookupRow}>
        <Text style={[styles.helper, error && styles.errorText]}>
          {error ?? (loading ? "Buscando datos del cliente…" : lookupLabel ?? "La búsqueda se inicia automáticamente al completar el documento.")}
        </Text>
        <Pressable accessibilityRole="button" onPress={() => void search()} disabled={loading}>
          <Text style={[styles.retry, loading && styles.disabled]}>Buscar</Text>
        </Pressable>
      </View>

      {isMock ? (
        <View style={styles.demoNotice}>
          <Text style={styles.demoNoticeText}>MODO DE PRUEBA: estos datos son simulados y no provienen de SUNAT ni de una consulta DNI real.</Text>
        </View>
      ) : null}

      <Text style={styles.label}>{tipoDoc === "DNI" ? "Nombre completo" : "Razón social"}</Text>
      <TextInput
        accessibilityLabel={tipoDoc === "DNI" ? "Nombre completo" : "Razón social"}
        value={nombre}
        onChangeText={onNombreChange}
        autoCapitalize="characters"
        placeholder={error ? "Escribe el nombre manualmente" : "Se completará automáticamente"}
        placeholderTextColor={theme.colors.muted}
        style={styles.nameInput}
      />

      {error ? (
        <View style={styles.manualNotice}>
          <Text style={styles.manualNoticeText}>Puedes continuar ingresando el nombre manualmente; la venta no queda bloqueada.</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: 7 },
  label: { color: theme.colors.text, fontWeight: "800", marginTop: 3 },
  inputShell: {
    minHeight: 51,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 13,
    paddingHorizontal: 14,
    backgroundColor: theme.colors.surface,
    flexDirection: "row",
    alignItems: "center"
  },
  inputShellError: { borderColor: theme.colors.warning },
  documentInput: { flex: 1, minHeight: 49, color: theme.colors.text, fontSize: 16, paddingRight: 10 },
  nameInput: {
    minHeight: 51,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 13,
    paddingHorizontal: 14,
    backgroundColor: theme.colors.surface,
    color: theme.colors.text,
    fontSize: 16
  },
  lookupRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  helper: { flex: 1, color: theme.colors.muted, fontSize: 12, lineHeight: 17 },
  errorText: { color: theme.colors.warning, fontWeight: "700" },
  retry: { color: theme.colors.primaryText, fontWeight: "900", paddingVertical: 2 },
  disabled: { opacity: 0.45 },
  manualNotice: { backgroundColor: theme.colors.warningSoft, borderRadius: 10, padding: 10 },
  manualNoticeText: { color: theme.colors.text, fontSize: 12, lineHeight: 17, fontWeight: "700" },
  demoNotice: { backgroundColor: theme.colors.primarySoft, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: theme.colors.primary },
  demoNoticeText: { color: theme.colors.text, fontSize: 12, lineHeight: 17, fontWeight: "800" }
});
