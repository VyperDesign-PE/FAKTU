import type { ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { theme } from "../theme";

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
  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={[styles.content, wide && (narrow ? styles.narrow : styles.wide)]} keyboardShouldPersistTaps="handled">
        {title ? <Text style={styles.title}>{title}</Text> : null}
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        {children}
      </ScrollView>
      {footer ? <View style={[styles.footer, wide && (narrow ? styles.narrow : styles.wide)]}>{footer}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: 20, gap: 14, flexGrow: 1 },
  narrow: { width: "100%", maxWidth: 460, alignSelf: "center", justifyContent: "center" },
  wide: { width: "100%", maxWidth: 880, alignSelf: "center" },
  title: { color: theme.colors.text, fontSize: 25, lineHeight: 31, fontWeight: "900" },
  subtitle: { color: theme.colors.muted, lineHeight: 21, marginTop: -5 },
  footer: { padding: 16, backgroundColor: theme.colors.background }
});
