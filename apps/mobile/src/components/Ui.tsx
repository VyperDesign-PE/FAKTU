import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { TextInputProps } from "react-native";
import { theme } from "../theme";

export function PrimaryButton({ label, onPress, disabled = false, tone = "primary" }: { label: string; onPress: () => void; disabled?: boolean; tone?: "primary" | "success" | "outline" }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.button, styles[tone], disabled && styles.disabled, pressed && !disabled && { opacity: 0.85 }]}
    >
      <Text style={[styles.buttonText, tone === "outline" && styles.outlineText]}>{label}</Text>
    </Pressable>
  );
}

type TextFieldProps = {
  label: string;
  error?: string;
} & Pick<
  TextInputProps,
  | "value"
  | "onChangeText"
  | "placeholder"
  | "keyboardType"
  | "secureTextEntry"
  | "autoCapitalize"
  | "autoComplete"
  | "textContentType"
  | "onSubmitEditing"
  | "returnKeyType"
  | "editable"
>;

export function TextField({
  label,
  error,
  value,
  onChangeText,
  placeholder,
  keyboardType = "default",
  secureTextEntry = false,
  autoCapitalize = "sentences",
  autoComplete,
  textContentType,
  onSubmitEditing,
  returnKeyType,
  editable = true
}: TextFieldProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        keyboardType={keyboardType}
        secureTextEntry={secureTextEntry}
        autoCapitalize={autoCapitalize}
        autoComplete={autoComplete}
        textContentType={textContentType}
        onSubmitEditing={onSubmitEditing}
        returnKeyType={returnKeyType}
        editable={editable}
        style={[styles.input, error && styles.inputError, !editable && styles.inputDisabled]}
        placeholderTextColor={theme.colors.muted}
        accessibilityLabel={label}
        accessibilityHint={error}
      />
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

export function Card({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "success" | "warning" | "danger" | "info" }) {
  return <View style={[styles.card, styles[`card_${tone}`]]}>{children}</View>;
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

export function InfoRow({ label, value }: { label: string; value: string }) {
  return <View style={styles.row}><Text style={styles.rowLabel}>{label}</Text><Text style={styles.rowValue}>{value}</Text></View>;
}

export function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress?: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected: Boolean(active) }} onPress={onPress} style={[styles.chip, active && styles.chipActive]}><Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  button: { minHeight: 52, borderRadius: 14, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  primary: { backgroundColor: theme.colors.primary },
  success: { backgroundColor: theme.colors.success },
  outline: { backgroundColor: theme.colors.surface, borderWidth: 1.5, borderColor: theme.colors.primary },
  disabled: { opacity: 0.45 },
  buttonText: { color: "white", fontWeight: "900", fontSize: 15, textAlign: "center" },
  outlineText: { color: theme.colors.primaryText },
  field: { gap: 7 },
  label: { color: theme.colors.text, fontWeight: "800" },
  input: { minHeight: 51, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 13, paddingHorizontal: 14, backgroundColor: theme.colors.surface, color: theme.colors.text, fontSize: 16 },
  inputError: { borderColor: theme.colors.danger, backgroundColor: theme.colors.dangerSoft },
  inputDisabled: { opacity: 0.72 },
  errorText: { color: theme.colors.danger, fontSize: 13, fontWeight: "700" },
  card: { backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 17, padding: 16, gap: 9 },
  card_default: {},
  card_success: { backgroundColor: theme.colors.successSoft, borderColor: theme.colors.successBorder },
  card_warning: { backgroundColor: theme.colors.warningSoft, borderColor: theme.colors.warningBorder },
  card_danger: { backgroundColor: theme.colors.dangerSoft, borderColor: theme.colors.dangerBorder },
  card_info: { backgroundColor: theme.colors.infoSoft, borderColor: theme.colors.infoBorder },
  sectionTitle: { fontSize: 17, fontWeight: "900", color: theme.colors.text, marginTop: 4 },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 12, paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border },
  rowLabel: { color: theme.colors.muted, flex: 1 },
  rowValue: { color: theme.colors.text, fontWeight: "800", flex: 1, textAlign: "right" },
  chip: { borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface, borderRadius: 999, minHeight: 44, justifyContent: "center", paddingHorizontal: 14 },
  chipActive: { borderColor: theme.colors.primary, backgroundColor: theme.colors.primarySoft },
  chipText: { color: theme.colors.muted, fontWeight: "800" },
  chipTextActive: { color: theme.colors.primaryText }
});
