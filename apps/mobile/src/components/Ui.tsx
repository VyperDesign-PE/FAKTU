import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { TextInputProps } from "react-native";
import { cardShadow, theme } from "../theme";
import { sentenceCase } from "../domain/text";
import { Icon, type IconName } from "./Icon";

export function PrimaryButton({ label, onPress, disabled = false, tone = "primary" }: { label: string; onPress: () => void; disabled?: boolean; tone?: "primary" | "success" | "outline" }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.button, styles[tone], disabled && styles.disabled, pressed && !disabled && { opacity: 0.85 }]}
    >
      <Text style={[styles.buttonText, tone === "outline" && styles.outlineText]}>{sentenceCase(label)}</Text>
    </Pressable>
  );
}

type TextFieldProps = {
  label: string;
  error?: string;
  /** Icono dentro del campo, a la izquierda. */
  icon?: IconName;
  /** Con secureTextEntry: botón para mostrar u ocultar lo escrito. */
  secureToggle?: boolean;
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
  editable = true,
  icon,
  secureToggle = false
}: TextFieldProps) {
  const [revealed, setRevealed] = useState(false);
  const hidden = secureTextEntry && !revealed;
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.inputWrap}>
      {icon ? <View style={styles.inputIcon}><Icon name={icon} size={18} color={theme.colors.muted} /></View> : null}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        keyboardType={keyboardType}
        secureTextEntry={hidden}
        autoCapitalize={autoCapitalize}
        autoComplete={autoComplete}
        textContentType={textContentType}
        onSubmitEditing={onSubmitEditing}
        returnKeyType={returnKeyType}
        editable={editable}
        style={[styles.input, icon && { paddingLeft: 44 }, secureToggle && { paddingRight: 48 }, error && styles.inputError, !editable && styles.inputDisabled]}
        placeholderTextColor={theme.colors.muted}
        accessibilityLabel={label}
        accessibilityHint={error}
      />
      {secureToggle && secureTextEntry ? (
        <Pressable accessibilityRole="button" accessibilityLabel={revealed ? "Ocultar contraseña" : "Mostrar contraseña"} onPress={() => setRevealed((value) => !value)} style={styles.reveal} hitSlop={6}>
          <Icon name={revealed ? "eyeOff" : "eye"} size={18} color={theme.colors.muted} />
        </Pressable>
      ) : null}
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

export function Card({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "success" | "warning" | "danger" | "info" }) {
  return <View style={[styles.card, cardShadow, styles[`card_${tone}`]]}>{children}</View>;
}

/** Tarjeta con cabecera: título a la izquierda, acción (enlace) a la derecha y una línea divisoria. */
export function Panel({ title, action, onAction, children, flush }: { title: string; action?: string; onAction?: () => void; children: ReactNode; flush?: boolean }) {
  return (
    <View style={[styles.panel, cardShadow]}>
      <View style={styles.panelHeader}>
        <Text accessibilityRole="header" style={styles.panelTitle}>{title}</Text>
        {action && onAction ? <Pressable accessibilityRole="link" onPress={onAction} hitSlop={8}><Text style={styles.panelAction}>{action}</Text></Pressable> : null}
      </View>
      <View style={flush ? undefined : styles.panelBody}>{children}</View>
    </View>
  );
}

/** Etiqueta de estado: siempre texto (el color solo refuerza). */
export function Badge({ label, tone = "muted" }: { label: string; tone?: "success" | "warning" | "danger" | "muted" | "info" }) {
  return <View style={[styles.badge, styles[`badge_${tone}`]]}><Text style={[styles.badgeText, styles[`badgeText_${tone}`]]}>{label}</Text></View>;
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
  button: { minHeight: 48, borderRadius: 10, alignItems: "center", justifyContent: "center", paddingHorizontal: 18 },
  primary: { backgroundColor: theme.colors.primary },
  // El tono "success" se conserva en la API de los botones, pero usa el color de marca: el verde se reserva para estados.
  success: { backgroundColor: theme.colors.primary },
  outline: { backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
  disabled: { opacity: 0.45 },
  buttonText: { color: "white", fontWeight: "700", fontSize: 15, textAlign: "center" },
  outlineText: { color: theme.colors.text },
  field: { gap: 7 },
  label: { color: theme.colors.text, fontWeight: "600" },
  inputWrap: { position: "relative", borderRadius: 10 },
  inputIcon: { position: "absolute", left: 14, top: 0, bottom: 0, justifyContent: "center", zIndex: 1 },
  reveal: { position: "absolute", right: 4, top: 4, bottom: 4, width: 40, alignItems: "center", justifyContent: "center", borderRadius: 8 },
  input: { minHeight: 48, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10, paddingHorizontal: 14, backgroundColor: theme.colors.surface, color: theme.colors.text, fontSize: 16 },
  inputError: { borderColor: theme.colors.danger, backgroundColor: theme.colors.dangerSoft },
  inputDisabled: { opacity: 0.72 },
  errorText: { color: theme.colors.danger, fontSize: 13, fontWeight: "600" },
  card: { backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, padding: 16, gap: 9 },
  card_default: {},
  card_success: { backgroundColor: theme.colors.successSoft, borderColor: theme.colors.successBorder },
  card_warning: { backgroundColor: theme.colors.warningSoft, borderColor: theme.colors.warningBorder },
  card_danger: { backgroundColor: theme.colors.dangerSoft, borderColor: theme.colors.dangerBorder },
  card_info: { backgroundColor: theme.colors.infoSoft, borderColor: theme.colors.infoBorder },
  sectionTitle: { fontSize: 17, fontWeight: "700", color: theme.colors.text, marginTop: 4 },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 12, paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border },
  rowLabel: { color: theme.colors.muted, flex: 1 },
  rowValue: { color: theme.colors.text, fontWeight: "600", flex: 1, textAlign: "right" },
  chip: { borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface, borderRadius: 10, minHeight: 44, justifyContent: "center", paddingHorizontal: 14 },
  chipActive: { borderColor: theme.colors.primary, backgroundColor: theme.colors.primarySoft },
  panel: { backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, overflow: "hidden" },
  panelHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingHorizontal: 18, minHeight: 54, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  panelTitle: { color: theme.colors.text, fontWeight: "700", fontSize: 15 },
  panelAction: { color: theme.colors.primaryText, fontWeight: "600", fontSize: 13 },
  panelBody: { padding: 18, gap: 10 },
  badge: { alignSelf: "flex-start", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1 },
  badge_success: { backgroundColor: theme.colors.successSoft, borderColor: theme.colors.successBorder },
  badge_warning: { backgroundColor: theme.colors.warningSoft, borderColor: theme.colors.warningBorder },
  badge_danger: { backgroundColor: theme.colors.dangerSoft, borderColor: theme.colors.dangerBorder },
  badge_info: { backgroundColor: theme.colors.infoSoft, borderColor: theme.colors.infoBorder },
  badge_muted: { backgroundColor: theme.colors.mutedSoft, borderColor: theme.colors.border },
  badgeText: { fontSize: 12, fontWeight: "600" },
  badgeText_success: { color: theme.colors.success },
  badgeText_warning: { color: theme.colors.warning },
  badgeText_danger: { color: theme.colors.danger },
  badgeText_info: { color: theme.colors.primaryText },
  badgeText_muted: { color: theme.colors.muted },
  chipText: { color: theme.colors.muted, fontWeight: "600" },
  chipTextActive: { color: theme.colors.primaryText }
});
