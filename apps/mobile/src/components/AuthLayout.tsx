import type { ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { theme } from "../theme";
import { BrandLogo } from "./Brand";
import { BrandBackdrop } from "./BrandBackdrop";
import { Icon, type IconName } from "./Icon";

/** Lo que FAKTU hace hoy (funciones existentes, sin promesas que el producto no cumple). */
const FEATURES: Array<{ icon: IconName; title: string; detail: string }> = [
  { icon: "receipt", title: "Boletas y facturas electrónicas", detail: "Emite y comparte comprobantes en segundos." },
  { icon: "wifi", title: "Sigue vendiendo sin Internet", detail: "Las ventas se guardan y se envían al volver la conexión." },
  { icon: "wallet", title: "Caja, fiados y stock", detail: "Cierre del día y registro de ventas para tu contador." },
  { icon: "shield", title: "Acceso protegido", detail: "Verificación en dos pasos y credenciales cifradas." }
];

/**
 * Pantallas de acceso: panel de marca a la izquierda y formulario a la derecha (escritorio);
 * en el celular, una franja de marca arriba y el formulario debajo.
 */
export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  const { width } = useWindowDimensions();
  const wide = width >= 960;

  return (
    <View style={styles.root}>
      {wide ? (
        <BrandBackdrop style={styles.brandPanel}>
          <BrandLogo size={40} light tagline="Facturación electrónica" />
          <View style={styles.pitch}>
            <Text style={styles.eyebrow}>Para bodegas, librerías y restaurantes del Perú</Text>
            <Text style={styles.headline}>Vende, factura y controla tu negocio desde un solo lugar.</Text>
            <View style={styles.features}>
              {FEATURES.map((feature) => (
                <View key={feature.title} style={styles.feature}>
                  <View style={styles.featureIcon}><Icon name={feature.icon} size={20} color="#FFFFFF" /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.featureTitle}>{feature.title}</Text>
                    <Text style={styles.featureDetail}>{feature.detail}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
          <Text style={styles.legal}>© {new Date().getFullYear()} FAKTU · Hecho para pequeños negocios del Perú</Text>
        </BrandBackdrop>
      ) : null}

      <ScrollView style={styles.formSide} contentContainerStyle={styles.formScroll} keyboardShouldPersistTaps="handled">
        {!wide ? (
          <BrandBackdrop style={styles.mobileBand}>
            <BrandLogo size={34} light tagline="Facturación electrónica" />
          </BrandBackdrop>
        ) : null}
        <View style={[styles.formBox, !wide && styles.formBoxMobile]}>
          <Text accessibilityRole="header" style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          <View style={styles.formBody}>{children}</View>
          {footer}
        </View>
      </ScrollView>
    </View>
  );
}

/** Separador "o" entre la acción principal y la alternativa. */
export function OrDivider() {
  return (
    <View style={styles.divider} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={styles.dividerLine} />
      <Text style={styles.dividerText}>o</Text>
      <View style={styles.dividerLine} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: "row", backgroundColor: theme.colors.surface },
  brandPanel: { width: "46%", maxWidth: 640, padding: 48, justifyContent: "space-between" },
  pitch: { gap: 18, maxWidth: 480 },
  eyebrow: { color: "#A9C2F2", fontWeight: "600", fontSize: 13, letterSpacing: 0.4, textTransform: "uppercase" },
  headline: { color: "#FFFFFF", fontWeight: "700", fontSize: 34, lineHeight: 42, letterSpacing: -0.6 },
  features: { gap: 18, marginTop: 10 },
  feature: { flexDirection: "row", gap: 14, alignItems: "flex-start" },
  featureIcon: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255, 255, 255, 0.12)", borderWidth: 1, borderColor: "rgba(255, 255, 255, 0.16)" },
  featureTitle: { color: "#FFFFFF", fontWeight: "600", fontSize: 15 },
  featureDetail: { color: "#C3D0EA", fontSize: 14, lineHeight: 20, marginTop: 2 },
  legal: { color: "#9FB0D3", fontSize: 12 },
  formSide: { flex: 1, backgroundColor: theme.colors.surface },
  formScroll: { flexGrow: 1, justifyContent: "center" },
  mobileBand: { paddingHorizontal: 20, paddingTop: 28, paddingBottom: 28 },
  formBox: { width: "100%", maxWidth: 420, alignSelf: "center", padding: 32, gap: 6 },
  formBoxMobile: { padding: 20, paddingTop: 24 },
  title: { color: theme.colors.text, fontWeight: "700", fontSize: 28, letterSpacing: -0.5 },
  subtitle: { color: theme.colors.muted, fontSize: 15, lineHeight: 22 },
  formBody: { gap: 14, marginTop: 18 },
  divider: { flexDirection: "row", alignItems: "center", gap: 12, marginVertical: 2 },
  dividerLine: { flex: 1, height: 1, backgroundColor: theme.colors.border },
  dividerText: { color: theme.colors.muted, fontSize: 13 }
});
