import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/types";
import { Screen } from "../../components/Screen";
import { Card, InfoRow, PrimaryButton, TextField } from "../../components/Ui";
import { useApp } from "../../context/AppContext";
import { getBillingSettings, lookupTaxpayer, requestOtp, verifyOtp, type BillingSettings } from "../../services/api";
import { theme } from "../../theme";
import { showAlert } from "../../components/platform";

type P<Name extends keyof RootStackParamList> = NativeStackScreenProps<RootStackParamList, Name>;

export function WelcomeScreen({ navigation }: P<"Welcome">) {
  return <Screen title="¡Bienvenido!" subtitle="Emite tus boletas y facturas desde tu celular.">
    <View style={styles.hero}><Text style={styles.heroIcon}>▣</Text><Text style={styles.heroTitle}>FAKTU</Text></View>
    <Card><Text style={styles.bullet}>✓ Fácil de usar</Text><Text style={styles.bullet}>✓ Pensado para pequeños negocios</Text><Text style={styles.bullet}>✓ Envía por WhatsApp, enlace o PDF</Text><Text style={styles.bullet}>✓ Puedes seguir vendiendo sin Internet</Text></Card>
    <PrimaryButton label="EMPEZAR" onPress={() => navigation.navigate("VerifyPhone")} />
  </Screen>;
}

export function VerifyPhoneScreen({ navigation }: P<"VerifyPhone">) {
  const { profile, setProfilePatch } = useApp();
  const [phone, setPhone] = useState(profile.phone ?? "");
  const [busy, setBusy] = useState(false);
  async function next() {
    if (phone.replace(/\D/g, "").length < 9) return showAlert("Revisa el número", "Ingresa un celular válido.");
    setBusy(true);
    try {
      const result = await requestOtp(phone);
      await setProfilePatch({ phone });
      // Sin proveedor SMS (producción del piloto) se continúa sin código.
      if (result.verificationRequired === false) navigation.navigate("EnterRuc");
      else navigation.navigate("OtpCode", { phone });
    }
    catch (e) { showAlert("No pudimos enviar el código", e instanceof Error ? e.message : "Intenta nuevamente."); }
    finally { setBusy(false); }
  }
  return <Screen title="Tu celular" subtitle="Lo usaremos para avisarte cuando tu facturación esté activa y darte soporte por WhatsApp.">
    <TextField label="Celular" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="999 999 999" />
    <Card tone="success"><Text style={styles.safe}>Tus datos están protegidos y no se comparten.</Text></Card>
    <PrimaryButton label={busy ? "ENVIANDO..." : "CONTINUAR"} onPress={next} disabled={busy} />
  </Screen>;
}

export function OtpCodeScreen({ navigation, route }: P<"OtpCode">) {
  const { profile } = useApp();
  const phone = route.params?.phone ?? profile.phone ?? "";
  const [code, setCode] = useState("123456");
  const [busy, setBusy] = useState(false);
  async function next() {
    setBusy(true);
    try { await verifyOtp(phone, code); navigation.navigate("EnterRuc"); }
    catch (e) { showAlert("Código incorrecto", e instanceof Error ? e.message : "Revisa el código."); }
    finally { setBusy(false); }
  }
  return <Screen title="Ingresa el código" subtitle={`Enviamos un código al ${phone}.`}>
    <TextField label="Código de verificación" value={code} onChangeText={setCode} keyboardType="number-pad" placeholder="123456" />
    <Card tone="info"><Text style={styles.note}>En el entorno de desarrollo el código es 123456.</Text></Card>
    <PrimaryButton label={busy ? "VERIFICANDO..." : "VERIFICAR"} onPress={next} disabled={busy || code.length !== 6} />
  </Screen>;
}

export function EnterRucScreen({ navigation }: P<"EnterRuc">) {
  const { profile } = useApp();
  const [ruc, setRuc] = useState(profile.ruc ?? "");
  return <Screen title="Ingresa el RUC de tu negocio" subtitle="Buscaremos la información de tu negocio.">
    <TextField label="RUC" value={ruc} onChangeText={setRuc} keyboardType="number-pad" placeholder="10XXXXXXXXX" />
    <PrimaryButton label="BUSCAR" onPress={() => ruc.length === 11 ? navigation.navigate("ConfirmBusiness", { ruc }) : showAlert("RUC inválido", "El RUC debe tener 11 dígitos.")} />
  </Screen>;
}

export function ConfirmBusinessScreen({ navigation, route }: P<"ConfirmBusiness">) {
  const { setProfilePatch } = useApp();
  const [business, setBusiness] = useState<{ ruc: string; businessName: string; tradeName?: string; status: string; address: string; source?: string; sourceUpdatedAt?: string; simulated?: boolean }>();
  const [error, setError] = useState<string>();
  const [manualName, setManualName] = useState("");
  const [manualAddress, setManualAddress] = useState("");

  useEffect(() => {
    lookupTaxpayer(route.params.ruc)
      .then((result) => {
        setBusiness(result);
        if (result.simulated) setError("Modo de prueba: estos datos son simulados y no provienen de una consulta real.");
      })
      .catch((e) => setError(e instanceof Error ? e.message : "No pudimos consultar el RUC. Puedes completar los datos manualmente."));
  }, [route.params.ruc]);

  async function confirm() {
    const businessName = business?.businessName || manualName.trim();
    if (!businessName) return showAlert("Falta la razón social", "Ingresa la razón social del negocio para continuar.");
    try {
      await setProfilePatch({
        ruc: route.params.ruc,
        businessName,
        tradeName: business?.tradeName,
        taxpayerStatus: business?.status || "POR VERIFICAR",
        address: business?.address || manualAddress.trim() || undefined
      }, { strict: true });
    } catch (cause) {
      return showAlert("No pudimos registrar tu negocio", cause instanceof Error ? cause.message : "Intenta nuevamente.");
    }
    navigation.navigate("SunatConnectionData");
  }

  return <Screen title={business ? "Encontramos tu negocio" : "Datos de tu negocio"} subtitle={business ? "Confirma que esta información corresponde a tu negocio." : "Si la consulta real aún no está conectada, puedes continuar manualmente."}>
    {!business && !error ? <ActivityIndicator size="large" color={theme.colors.primary} /> : null}
    {error ? <Card tone={business?.simulated ? "warning" : "info"}><Text style={styles.note}>{error}</Text></Card> : null}
    {business ? <Card tone={business.simulated ? "warning" : "success"}><Text style={styles.business}>{business.tradeName ?? business.businessName}</Text><InfoRow label="RUC" value={business.ruc} /><InfoRow label="Razón social" value={business.businessName} /><InfoRow label="Estado" value={business.status || "-"} /><InfoRow label="Dirección" value={business.address || "-"} />{business.simulated ? <Text style={styles.note}>DATOS SIMULADOS · no usar como información tributaria real.</Text> : business.source === "SUNAT_RUC_PADRON" ? <Text style={styles.note}>Fuente: Padrón Reducido oficial de SUNAT{business.sourceUpdatedAt ? ` · actualizado ${business.sourceUpdatedAt}` : ""}.</Text> : null}</Card> : null}
    {!business ? <>
      <TextField label="RUC" value={route.params.ruc} onChangeText={() => {}} keyboardType="number-pad" />
      <TextField label="Razón social" value={manualName} onChangeText={setManualName} placeholder="Escribe la razón social" autoCapitalize="characters" />
      <TextField label="Dirección (opcional)" value={manualAddress} onChangeText={setManualAddress} placeholder="Dirección del negocio" />
    </> : null}
    <PrimaryButton label={business ? "SÍ, ESTE ES MI NEGOCIO" : "CONTINUAR CON DATOS MANUALES"} onPress={confirm} disabled={!business && !manualName.trim()} tone="success" />
    <PrimaryButton label="NO, BUSCAR OTRO RUC" onPress={() => navigation.goBack()} tone="outline" />
  </Screen>;
}

/**
 * Activación de la facturación electrónica.
 *
 * FAKTU NUNCA pide la Clave SOL principal. Para emitir, el negocio crea un
 * usuario SOL secundario con permiso solo de emisión (lo puede desactivar
 * cuando quiera) y cuenta con un certificado digital; FAKTU registra la
 * empresa en su proveedor de facturación y activa la cuenta.
 * Mientras tanto se puede practicar en modo pruebas, sin validez tributaria.
 */
export function SunatConnectionDataScreen({ navigation }: P<"SunatConnectionData">) {
  return <Screen title="Facturación electrónica" subtitle="Así activamos tus comprobantes ante SUNAT. Te acompañamos en cada paso.">
    <Card tone="info">
      <Text style={styles.bullet}>1. Tu certificado digital: si no lo tienes, te ayudamos a obtenerlo.</Text>
      <Text style={styles.bullet}>2. En SUNAT Operaciones en Línea creas un usuario secundario solo para facturar. Te guiamos por WhatsApp.</Text>
      <Text style={styles.bullet}>3. Registramos tu negocio en nuestro proveedor de facturación, hacemos una boleta de prueba y te avisamos cuando todo esté activo.</Text>
    </Card>
    <Card tone="warning"><Text style={styles.note}>Mientras se activa, FAKTU funciona en modo pruebas: puedes vender y practicar, pero esos comprobantes no tienen validez tributaria.</Text></Card>
    <Card><Text style={styles.note}>Nunca te pediremos tu Clave SOL principal, ni por teléfono, ni por WhatsApp, ni en esta app. El usuario secundario solo puede emitir comprobantes y tú lo puedes desactivar cuando quieras.</Text></Card>
    <PrimaryButton label="ENTENDIDO, CONTINUAR" onPress={() => navigation.navigate("EnabledDocuments")} tone="success" />
  </Screen>;
}

/** Ruta conservada por compatibilidad: redirige al paso de activación. */
export function AuthorizePseScreen({ navigation }: P<"AuthorizePse">) {
  useEffect(() => { navigation.replace("SunatConnectionData"); }, [navigation]);
  return <Screen title="Facturación electrónica"><ActivityIndicator color={theme.colors.primary} /></Screen>;
}

export function AuthorizingScreen({ navigation }: P<"Authorizing">) {
  useEffect(() => { const timer = setTimeout(() => navigation.replace("EnabledDocuments"), 1200); return () => clearTimeout(timer); }, [navigation]);
  return <Screen title="Autorizando..." subtitle="Estamos verificando la conexión de tu negocio.">
    <View style={styles.center}><ActivityIndicator size="large" color={theme.colors.primary} /><Text style={styles.centerText}>Conectando con SUNAT/PSE</Text><Text style={styles.centerText}>Verificando autorización</Text><Text style={styles.centerText}>Finalizando configuración</Text></View>
  </Screen>;
}

export function EnabledDocumentsScreen({ navigation }: P<"EnabledDocuments">) {
  return <Screen title="Comprobantes habilitados" subtitle="Según la configuración del negocio, podrás emitir:">
    <Card tone="success"><Text style={styles.doc}>✓ BOLETA ELECTRÓNICA</Text><Text>Para ventas al público.</Text></Card>
    <Card tone="info"><Text style={styles.doc}>✓ FACTURA ELECTRÓNICA</Text><Text>Para operaciones con RUC.</Text></Card>
    <Card><Text style={styles.note}>Estas opciones deberán actualizarse automáticamente si cambia la situación tributaria del negocio.</Text></Card>
    <PrimaryButton label="CONTINUAR" onPress={() => navigation.navigate("Ready")} />
  </Screen>;
}

function connectionLabel(settings?: BillingSettings) {
  if (!settings) return "Consultando...";
  if (settings.providerCode === "mock") return "Modo pruebas (sin validez tributaria)";
  if (!settings.credentialConfigured) return "Pendiente de activación";
  return settings.environment === "production" ? "Activa ante SUNAT" : "Activa en ambiente de pruebas";
}

export function ReadyScreen({ navigation }: P<"Ready">) {
  const { profile, completeOnboarding } = useApp();
  const [billing, setBilling] = useState<BillingSettings>();
  useEffect(() => { getBillingSettings().then(setBilling).catch(() => undefined); }, []);
  async function finish() { await completeOnboarding(); navigation.reset({ index: 0, routes: [{ name: "Dashboard" }] }); }
  return <Screen title="¡Todo listo!" subtitle="Tu negocio ya está configurado para comenzar.">
    <View style={styles.ready}><Text style={styles.check}>✓</Text></View>
    <Card tone="success"><InfoRow label="Negocio" value={profile.tradeName ?? profile.businessName ?? "Mi negocio"} /><InfoRow label="RUC" value={profile.ruc ?? "-"} /><InfoRow label="Comprobantes" value="Boleta y Factura" /><InfoRow label="Facturación" value={connectionLabel(billing)} /></Card>
    <PrimaryButton label="HACER MI PRIMERA VENTA" onPress={finish} tone="success" />
  </Screen>;
}

const styles = StyleSheet.create({
  hero: { alignItems: "center", paddingVertical: 24, gap: 8 }, heroIcon: { fontSize: 58, color: theme.colors.primary }, heroTitle: { fontSize: 22, fontWeight: "900", color: theme.colors.primary },
  bullet: { color: theme.colors.text, lineHeight: 23, fontWeight: "700" }, safe: { color: theme.colors.success, fontWeight: "800" }, note: { color: theme.colors.muted, lineHeight: 20 },
  business: { fontSize: 19, fontWeight: "900", color: theme.colors.success, textAlign: "center", marginBottom: 4 }, doc: { fontWeight: "900", color: theme.colors.text },
  center: { flex: 1, minHeight: 340, alignItems: "center", justifyContent: "center", gap: 14 }, centerText: { color: theme.colors.muted, fontWeight: "700" },
  ready: { alignItems: "center", padding: 10 }, check: { width: 76, height: 76, borderRadius: 38, backgroundColor: theme.colors.success, color: "white", textAlign: "center", textAlignVertical: "center", fontSize: 48, fontWeight: "900", lineHeight: 76 }
});
