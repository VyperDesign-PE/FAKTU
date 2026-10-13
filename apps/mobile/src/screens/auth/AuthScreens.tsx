import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/types";
import { AuthLayout, OrDivider } from "../../components/AuthLayout";
import { Icon } from "../../components/Icon";
import { PrimaryButton, TextField } from "../../components/Ui";
import { useAuth } from "../../context/AuthContext";
import { getPublicConfig } from "../../services/api";
import { hasErrors, normalizeEmail, validateLogin, validateRegistration } from "../../auth/validation";
import { theme } from "../../theme";
import { showAlert } from "../../components/platform";

type P<Name extends keyof RootStackParamList> = NativeStackScreenProps<RootStackParamList, Name>;

function SecurityNote() {
  return (
    <View style={styles.note}>
      <Icon name="lock" size={16} color={theme.colors.muted} />
      <Text style={styles.noteText}>Conexión cifrada. Tu sesión se guarda de forma segura en este dispositivo y nunca almacenamos tu contraseña en él.</Text>
    </View>
  );
}

export function LoginScreen({ navigation }: P<"Login">) {
  const { signIn, completeMfa } = useAuth();
  const [mfaToken, setMfaToken] = useState<string>();
  const [demo, setDemo] = useState<{ email: string; password: string; business: string } | null>(null);
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  useEffect(() => { getPublicConfig().then((config) => setDemo(config.demo)).catch(() => undefined); }, []);

  const errors = useMemo(() => validateLogin(email, password), [email, password]);

  async function enterDemo() {
    if (!demo) return;
    setBusy(true);
    try {
      await signIn(demo.email, demo.password);
      navigation.reset({ index: 0, routes: [{ name: "Dashboard" }] });
    } catch (error) {
      showAlert("No pudimos abrir la demo", error instanceof Error ? error.message : "Intenta nuevamente.");
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    setSubmitted(true);
    if (!mfaToken && hasErrors(errors)) return;
    setBusy(true);
    try {
      if (mfaToken) {
        await completeMfa(mfaToken, code.trim());
        navigation.reset({ index: 0, routes: [{ name: "Dashboard" }] });
        return;
      }
      const result = await signIn(normalizeEmail(email), password);
      if (result.mfaToken) { setMfaToken(result.mfaToken); return; }
      navigation.reset({ index: 0, routes: [{ name: "Dashboard" }] });
    } catch (error) {
      showAlert("No pudimos ingresar", error instanceof Error ? error.message : "Verifica tus datos e inténtalo nuevamente.");
    } finally {
      setBusy(false);
    }
  }

  function forgotPassword() {
    // La recuperación automática todavía no existe en el servidor: se explica en vez de simularla.
    showAlert("Recuperar contraseña", "La recuperación automática todavía no está disponible. Escribe al soporte de FAKTU desde el correo con el que te registraste y te ayudaremos a recuperar el acceso.");
  }

  if (mfaToken) {
    return (
      <AuthLayout title="Verificación en dos pasos" subtitle="Abre tu app de autenticación e ingresa el código de 6 dígitos de FAKTU. También puedes usar un código de recuperación.">
        <TextField label="Código de verificación" icon="shield" value={code} onChangeText={(v) => setCode(v.replace(/[^\dA-Za-z-]/g, "").slice(0, 12))} keyboardType="default" autoCapitalize="none" placeholder="123456" autoComplete="one-time-code" onSubmitEditing={() => void submit()} />
        <PrimaryButton label={busy ? "Verificando…" : "Verificar e ingresar"} onPress={() => void submit()} disabled={busy || code.length < 6} />
        <Pressable accessibilityRole="button" onPress={() => { setMfaToken(undefined); setCode(""); }} style={styles.linkRow}>
          <Icon name="back" size={16} color={theme.colors.primaryText} />
          <Text style={styles.link}>Usar otra cuenta</Text>
        </Pressable>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Ingresa a tu cuenta"
      subtitle="Bienvenido de nuevo. Ingresa con el correo de tu negocio."
      footer={
        <View style={styles.footer}>
          <View style={styles.switchRow}>
            <Text style={styles.switchText}>¿Aún no tienes una cuenta?</Text>
            <Pressable accessibilityRole="link" onPress={() => navigation.navigate("Register")} hitSlop={8}>
              <Text style={styles.link}>Crear cuenta</Text>
            </Pressable>
          </View>
          <SecurityNote />
        </View>
      }
    >
      <TextField
        label="Correo electrónico"
        icon="mail"
        value={email}
        onChangeText={setEmail}
        placeholder="tu@negocio.pe"
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        textContentType="emailAddress"
        error={submitted ? errors.email : undefined}
      />
      <TextField
        label="Contraseña"
        icon="lock"
        value={password}
        onChangeText={setPassword}
        placeholder="Tu contraseña"
        secureTextEntry
        secureToggle
        autoCapitalize="none"
        autoComplete="current-password"
        textContentType="password"
        error={submitted ? errors.password : undefined}
        onSubmitEditing={submit}
      />
      <Pressable accessibilityRole="button" onPress={forgotPassword} style={styles.forgot} hitSlop={6}>
        <Text style={styles.linkSmall}>¿Olvidaste tu contraseña?</Text>
      </Pressable>
      <PrimaryButton label={busy ? "Ingresando…" : "Ingresar"} onPress={submit} disabled={busy} />

      {demo ? (
        <>
          <OrDivider />
          <Pressable accessibilityRole="button" onPress={() => void enterDemo()} disabled={busy} style={({ hovered }: { pressed: boolean; hovered?: boolean }) => [styles.demo, hovered && { backgroundColor: theme.colors.hover }]}>
            <View style={styles.demoIcon}><Icon name="zap" size={18} color={theme.colors.primaryText} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.demoTitle}>Explorar la demo</Text>
              <Text style={styles.demoText}>{demo.business}: ventas, fiados y stock con datos de prueba (sin validez SUNAT).</Text>
            </View>
            <Icon name="chevron" size={18} color={theme.colors.muted} />
          </Pressable>
        </>
      ) : null}
    </AuthLayout>
  );
}

export function RegisterScreen({ navigation }: P<"Register">) {
  const { signUp } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const errors = useMemo(() => validateRegistration(email, password, confirmPassword), [email, password, confirmPassword]);

  async function submit() {
    setSubmitted(true);
    if (hasErrors(errors)) return;
    setBusy(true);
    try {
      await signUp(normalizeEmail(email), password);
      navigation.reset({ index: 0, routes: [{ name: "VerifyPhone" }] });
    } catch (error) {
      showAlert("No pudimos crear la cuenta", error instanceof Error ? error.message : "Inténtalo nuevamente.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Crea tu cuenta"
      subtitle="Primero creamos tu acceso. Después configuramos tu negocio en unos minutos."
      footer={
        <View style={styles.footer}>
          <View style={styles.switchRow}>
            <Text style={styles.switchText}>¿Ya tienes una cuenta?</Text>
            <Pressable accessibilityRole="link" onPress={() => navigation.navigate("Login")} hitSlop={8}>
              <Text style={styles.link}>Ingresar</Text>
            </Pressable>
          </View>
          <SecurityNote />
        </View>
      }
    >
      <TextField
        label="Correo electrónico"
        icon="mail"
        value={email}
        onChangeText={setEmail}
        placeholder="tu@negocio.pe"
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        textContentType="emailAddress"
        error={submitted ? errors.email : undefined}
      />
      <TextField
        label="Contraseña"
        icon="lock"
        value={password}
        onChangeText={setPassword}
        placeholder="Mínimo 8 caracteres"
        secureTextEntry
        secureToggle
        autoCapitalize="none"
        autoComplete="new-password"
        textContentType="newPassword"
        error={submitted ? errors.password : undefined}
      />
      <TextField
        label="Confirmar contraseña"
        icon="lock"
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        placeholder="Repite tu contraseña"
        secureTextEntry
        secureToggle
        autoCapitalize="none"
        autoComplete="new-password"
        textContentType="newPassword"
        error={submitted ? errors.confirmPassword : undefined}
        onSubmitEditing={submit}
      />
      <PrimaryButton label={busy ? "Creando cuenta…" : "Crear cuenta"} onPress={submit} disabled={busy} />
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  footer: { gap: 18, marginTop: 22 },
  switchRow: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6, flexWrap: "wrap" },
  switchText: { color: theme.colors.muted, fontSize: 14 },
  link: { color: theme.colors.primaryText, fontWeight: "600", fontSize: 14 },
  linkSmall: { color: theme.colors.primaryText, fontWeight: "600", fontSize: 13 },
  linkRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 44 },
  forgot: { alignSelf: "flex-end", minHeight: 32, justifyContent: "center", marginTop: -6 },
  demo: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
  demoIcon: { width: 40, height: 40, borderRadius: 10, backgroundColor: theme.colors.primarySoft, alignItems: "center", justifyContent: "center" },
  demoTitle: { color: theme.colors.text, fontWeight: "600", fontSize: 15 },
  demoText: { color: theme.colors.muted, fontSize: 13, lineHeight: 18, marginTop: 2 },
  note: { flexDirection: "row", gap: 10, alignItems: "flex-start", padding: 12, borderRadius: 10, backgroundColor: theme.colors.mutedSoft },
  noteText: { flex: 1, color: theme.colors.muted, fontSize: 12, lineHeight: 18 }
});
