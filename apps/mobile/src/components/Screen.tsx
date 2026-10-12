import type { ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { theme } from "../theme";

type Props = {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
};

export function Screen({ title, subtitle, children, footer }: Props) {
  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {title ? <Text style={styles.title}>{title}</Text> : null}
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        {children}
      </ScrollView>
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: 20, gap: 14, flexGrow: 1 },
  title: { color: theme.colors.text, fontSize: 25, lineHeight: 31, fontWeight: "900" },
  subtitle: { color: theme.colors.muted, lineHeight: 21, marginTop: -5 },
  footer: { padding: 16, backgroundColor: theme.colors.background }
});
