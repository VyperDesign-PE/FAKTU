import { useCallback, useEffect, useState } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/types";
import { Screen } from "../../components/Screen";
import { Card, InfoRow, PrimaryButton, SectionTitle, TextField } from "../../components/Ui";
import { showAlert } from "../../components/platform";
import { disableMfa, enableMfa, getMfaStatus, listAuditLog, logoutAllDevices, startMfaSetup, type AuditEntry } from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import { theme } from "../../theme";

type P = NativeStackScreenProps<RootStackParamList, "Seguridad">;

const ACTION_LABELS: Record<string, string> = {
  LOGIN: "Ingreso", LOGOUT: "Salida", LOGOUT_ALL: "Cierre en todos los dispositivos", MFA_RECOVERY_USED: "Ingreso con código de recuperación", SESSION_REFRESH_DENIED: "Sesión rechazada", LOGIN_FAILED: "Ingreso fallido", USER_REGISTER: "Cuenta creada", MFA_ENABLED: "2FA activada", MFA_DISABLED: "2FA desactivada",
  RECEIPT_CREATE: "Venta registrada", RECEIPT_VOID: "Venta anulada", CREDIT_NOTE_CREATE: "Nota de crédito", DEBIT_NOTE_CREATE: "Nota de débito",
  VOIDING_REQUEST: "Comunicación de baja", GUIDE_CREATE: "Guía de remisión", RECEIVABLE_PAYMENT: "Cobro de fiado", STOCK_ADJUST: "Ajuste de stock",
  PRODUCT_DELETE: "Producto eliminado", BILLING_SETTINGS_UPDATE: "Cambio de facturación", BUSINESS_UPDATE: "Datos del negocio", EXPORT_LINK_CREATE: "Descarga para el contador", SECRET_SET: "Credencial actualizada"
};

export function SeguridadScreen(_: P) {
  const { signOut } = useAuth();
  const [enabled, setEnabled] = useState<boolean>();
  const [codesLeft, setCodesLeft] = useState<number>();
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>();
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string }>();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<AuditEntry[]>();
  const [logDenied, setLogDenied] = useState(false);

  const load = useCallback(async () => {
    try { const status = await getMfaStatus(); setEnabled(status.enabled); setCodesLeft(status.recoveryCodesLeft); } catch { /* sin conexión */ }
    listAuditLog().then(setLog).catch(() => setLogDenied(true));
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function begin() {
    setBusy(true);
    try { setSetup(await startMfaSetup()); } catch (e) { showAlert("No pudimos iniciar", e instanceof Error ? e.message : "Intenta nuevamente."); } finally { setBusy(false); }
  }

  async function confirm() {
    setBusy(true);
    try {
      const result = await enableMfa(code.trim());
      setSetup(undefined); setCode(""); setEnabled(true);
      setRecoveryCodes(result.recoveryCodes);
      void load();
    } catch (e) { showAlert("Código incorrecto", e instanceof Error ? e.message : "Intenta nuevamente."); } finally { setBusy(false); }
  }

  async function closeEverywhere() {
    setBusy(true);
    try { await logoutAllDevices(); await signOut(); }
    catch (e) { showAlert("No pudimos cerrar las sesiones", e instanceof Error ? e.message : "Intenta nuevamente."); setBusy(false); }
  }

  async function turnOff() {
    setBusy(true);
    try { await disableMfa(code.trim()); setCode(""); setEnabled(false); void load(); }
    catch (e) { showAlert("No pudimos desactivar", e instanceof Error ? e.message : "Intenta nuevamente."); } finally { setBusy(false); }
  }

  return <Screen title="Seguridad" subtitle="Protege tu cuenta y revisa quién hizo qué en tu negocio.">
    <SectionTitle>Verificación en dos pasos</SectionTitle>
    <Card tone={enabled ? "success" : "warning"}>
      <InfoRow label="Estado" value={enabled === undefined ? "…" : enabled ? "Activa" : "Desactivada"} />
      <Text style={styles.copy}>Aunque alguien robe tu contraseña, no podrá entrar sin el código de tu celular. Recomendado para el dueño del negocio.</Text>
    </Card>

    {enabled === false && !setup ? <PrimaryButton label={busy ? "PREPARANDO…" : "ACTIVAR VERIFICACIÓN EN DOS PASOS"} onPress={() => void begin()} disabled={busy} /> : null}

    {setup ? <Card>
      <Text style={styles.step}>1. Abre Google Authenticator, Authy o 1Password y agrega una cuenta con esta clave:</Text>
      <Text selectable style={styles.secret}>{setup.secret}</Text>
      <PrimaryButton label="ABRIR MI APP DE AUTENTICACIÓN" onPress={() => void Linking.openURL(setup.otpauthUrl).catch(() => showAlert("Copia la clave", "Escribe la clave manualmente en tu app de autenticación."))} tone="outline" />
      <Text style={styles.step}>2. Escribe el código de 6 dígitos que muestra la app:</Text>
      <TextField label="Código" value={code} onChangeText={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" placeholder="123456" />
      <PrimaryButton label={busy ? "VERIFICANDO…" : "CONFIRMAR Y ACTIVAR"} onPress={() => void confirm()} disabled={busy || code.length !== 6} />
    </Card> : null}

    {recoveryCodes ? <Card tone="warning">
      <Text style={styles.step}>Guarda estos códigos de recuperación en un lugar seguro (foto, papel o gestor de contraseñas). Cada uno sirve una sola vez si pierdes tu celular. No los volveremos a mostrar.</Text>
      <View style={styles.codes}>{recoveryCodes.map((item) => <Text key={item} selectable style={styles.code}>{item}</Text>)}</View>
      <PrimaryButton label="YA LOS GUARDÉ" onPress={() => setRecoveryCodes(undefined)} />
    </Card> : null}

    {enabled && !recoveryCodes ? <Card>
      {codesLeft !== undefined ? <InfoRow label="Códigos de recuperación disponibles" value={String(codesLeft)} /> : null}
      <Text style={styles.copy}>Para desactivarla, escribe un código actual de tu app de autenticación.</Text>
      <TextField label="Código actual" value={code} onChangeText={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" placeholder="123456" />
      <PrimaryButton label="DESACTIVAR" onPress={() => void turnOff()} tone="outline" disabled={busy || code.length !== 6} />
    </Card> : null}

    <SectionTitle>Sesiones</SectionTitle>
    <Card>
      <Text style={styles.copy}>¿Perdiste un celular o usaste una computadora ajena? Cierra la sesión en todos los dispositivos.</Text>
      <PrimaryButton label="CERRAR SESIÓN EN TODOS LOS DISPOSITIVOS" onPress={() => void closeEverywhere()} tone="outline" disabled={busy} />
    </Card>

    <SectionTitle>Actividad reciente</SectionTitle>
    {logDenied ? <Card><Text style={styles.copy}>El registro de actividad solo lo ve el propietario o administrador.</Text></Card> : null}
    {log && !log.length ? <Card><Text style={styles.copy}>Aún no hay actividad.</Text></Card> : null}
    {log?.length ? <View style={styles.table}>
      {log.slice(0, 40).map((entry) => (
        <View key={entry.id} style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.action}>{ACTION_LABELS[entry.action] ?? entry.action}</Text>
            <Text style={styles.sub}>{new Date(entry.createdAt).toLocaleString("es-PE", { dateStyle: "short", timeStyle: "short" })}{entry.ip ? ` · ${entry.ip}` : ""}</Text>
          </View>
        </View>
      ))}
    </View> : null}
  </Screen>;
}

const styles = StyleSheet.create({
  copy: { color: theme.colors.muted, lineHeight: 21 },
  step: { color: theme.colors.text, fontWeight: "700", lineHeight: 21 },
  secret: { color: theme.colors.primaryText, fontWeight: "900", fontSize: 20, letterSpacing: 2, paddingVertical: 6 },
  codes: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  code: { fontWeight: "900", fontSize: 16, color: theme.colors.text, letterSpacing: 1, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
  table: { backgroundColor: theme.colors.surface, borderRadius: 16, borderWidth: 1, borderColor: theme.colors.border, overflow: "hidden" },
  row: { paddingHorizontal: 16, paddingVertical: 11, flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border },
  action: { color: theme.colors.text, fontWeight: "800" },
  sub: { color: theme.colors.muted, fontSize: 12.5 }
});
