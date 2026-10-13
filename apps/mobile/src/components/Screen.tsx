import type { ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { theme } from "../theme";
import { BackButton, DesktopFrame } from "./ResponsiveShell";
import { useApp } from "../context/AppContext";
import { useAuth } from "../context/AuthContext";

type Props = {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Formularios cortos (ingreso, registro): columna angosta y centrada en pantallas grandes. */
  narrow?: boolean;
};

export function Screen({ title, subtitle, children, footer, narrow }: Props) {
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const { profile } = useApp();
  const { isAuthenticated } = useAuth();
  // Con sesión y alta completa, las pantallas secundarias comparten el menú y la barra superior de escritorio.
  const framed = wide && isAuthenticated && profile.onboardingComplete && !narrow;
  const page = (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={[styles.content, wide && (narrow ? styles.narrow : framed ? styles.framedWide : styles.wide)]} keyboardShouldPersistTaps="handled">
        {framed ? null : <View style={styles.backRow}><BackButton /></View>}
        {title ? <Text accessibilityRole="header" style={styles.title}>{title}</Text> : null}
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        {children}
      </ScrollView>
      {footer ? <View style={[styles.footer, wide && (narrow ? styles.narrow : styles.wide)]}>{footer}</View> : null}
    </View>
  );
  return framed ? <DesktopFrame>{page}</DesktopFrame> : page;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: 20, gap: 14, flexGrow: 1 },
  narrow: { width: "100%", maxWidth: 460, alignSelf: "center", justifyContent: "center" },
  wide: { width: "100%", maxWidth: 880, alignSelf: "center" },
  framedWide: { width: "100%", maxWidth: 960, alignSelf: "flex-start", padding: 28 },
  backRow: { flexDirection: "row", marginBottom: -4 },
  title: { color: theme.colors.text, fontSize: 24, lineHeight: 30, fontWeight: "700", letterSpacing: -0.3 },
  subtitle: { color: theme.colors.muted, lineHeight: 21, marginTop: -5 },
  footer: { padding: 16, backgroundColor: theme.colors.background }
});
