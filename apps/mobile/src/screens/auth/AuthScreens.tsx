import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/types";
import { Screen } from "../../components/Screen";
import { BrandLogo } from "../../components/Brand";
import { Card, PrimaryButton, TextField } from "../../components/Ui";
import { useAuth } from "../../context/AuthContext";
import { hasErrors, normalizeEmail, validateLogin, validateRegistration } from "../../auth/validation";
import { theme } from "../../theme";
import { showAlert } from "../../components/platform";

type P<Name extends keyof RootStackParamList> = NativeStackScreenProps<RootStackParamList, Name>;

function AuthHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <View style={styles.header}>
      <BrandLogo size={52} />
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
    </View>
  );
}

export function LoginScreen({ navigation }: P<"Login">) {
  const { signIn, completeMfa } = useAuth();
  const [mfaToken, setMfaToken] = useState<string>();
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const errors = useMemo(() => validateLogin(email, password), [email, password]);

  async function submit() {
    setSubmitted(true);
    if (hasErrors(errors)) return;
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

  if (mfaToken) {
    return (
      <Screen narrow>
        <AuthHeader title="Verificación en dos pasos" subtitle="Abre tu app de autenticación e ingresa el código de 6 dígitos de Faktu." />
        <Card>
          <TextField label="Código de 6 dígitos" value={code} onChangeText={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" placeholder="123456" autoComplete="one-time-code" onSubmitEditing={() => void submit()} />
          <PrimaryButton label={busy ? "VERIFICANDO..." : "VERIFICAR"} onPress={() => void submit()} disabled={busy || code.length !== 6} />
          <Pressable onPress={() => { setMfaToken(undefined); setCode(""); }}><Text style={styles.link}>Volver</Text></Pressable>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen narrow>
      <AuthHeader title="Bienvenido nuevamente" subtitle="Ingresa para continuar con tu negocio." />
      <Card>
        <TextField
          label="Correo electrónico"
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
          value={password}
          onChangeText={setPassword}
          placeholder="••••••••"
          secureTextEntry
          autoCapitalize="none"
          autoComplete="current-password"
          textContentType="password"
          error={submitted ? errors.password : undefined}
          onSubmitEditing={submit}
        />
        <PrimaryButton label={busy ? "INGRESANDO..." : "INGRESAR"} onPress={submit} disabled={busy} />
      </Card>

      <View style={styles.registerBox}>
        <Text style={styles.registerText}>¿Aún no tienes una cuenta?</Text>
        <Pressable accessibilityRole="button" onPress={() => navigation.navigate("Register")} hitSlop={8}>
          <Text style={styles.registerLink}>REGISTRARME</Text>
        </Pressable>
      </View>

      <Card tone="info">
        <Text style={styles.securityText}>Tu sesión se guarda de forma segura en el dispositivo. Nunca almacenamos tu contraseña.</Text>
      </Card>
    </Screen>
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
    <Screen narrow>
      <AuthHeader title="Crea tu cuenta" subtitle="Primero creamos tu acceso. Luego configuramos el negocio." />
      <Card>
        <TextField
          label="Correo electrónico"
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
          value={password}
          onChangeText={setPassword}
          placeholder="Mínimo 8 caracteres"
          secureTextEntry
          autoCapitalize="none"
          autoComplete="new-password"
          textContentType="newPassword"
          error={submitted ? errors.password : undefined}
        />
        <TextField
          label="Confirmar contraseña"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          placeholder="Repite tu contraseña"
          secureTextEntry
          autoCapitalize="none"
          autoComplete="new-password"
          textContentType="newPassword"
          error={submitted ? errors.confirmPassword : undefined}
          onSubmitEditing={submit}
        />
        <PrimaryButton label={busy ? "CREANDO CUENTA..." : "CREAR CUENTA"} onPress={submit} disabled={busy} tone="success" />
      </Card>

      <View style={styles.registerBox}>
        <Text style={styles.registerText}>¿Ya tienes una cuenta?</Text>
        <Pressable accessibilityRole="button" onPress={() => navigation.navigate("Login")} hitSlop={8}>
          <Text style={styles.registerLink}>INGRESAR</Text>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  link: { color: theme.colors.primary, fontWeight: "800", textAlign: "center", paddingVertical: 6 },
  header: { alignItems: "center", gap: 8, paddingTop: 24, paddingBottom: 12 },
  logo: { width: 68, height: 68, borderRadius: 22, backgroundColor: theme.colors.primary, alignItems: "center", justifyContent: "center" },
  logoText: { color: "white", fontWeight: "900", fontSize: 26 },
  title: { color: theme.colors.text, fontSize: 27, fontWeight: "900", textAlign: "center" },
  subtitle: { color: theme.colors.muted, lineHeight: 21, textAlign: "center", maxWidth: 320 },
  registerBox: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8, paddingVertical: 4 },
  registerText: { color: theme.colors.muted },
  registerLink: { color: theme.colors.primary, fontWeight: "900" },
  securityText: { color: theme.colors.muted, lineHeight: 20, textAlign: "center" }
});
