import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/types";
import { Screen } from "../../components/Screen";
import { Card, Chip, InfoRow, PrimaryButton, SectionTitle, TextField } from "../../components/Ui";
import { CustomerDocumentLookupField } from "../../components/customer/CustomerDocumentLookupField";
import { useApp } from "../../context/AppContext";
import { useAuth } from "../../context/AuthContext";
import {
  listRemoteCustomers,
  saveRemoteCustomer,
  type RemoteCustomer
} from "../../services/api";
import { listCachedCustomers, saveCachedCustomer } from "../../storage/customerCache";
import { theme } from "../../theme";
import { showAlert } from "../../components/platform";

type P<Name extends keyof RootStackParamList> = NativeStackScreenProps<RootStackParamList, Name>;

export function CustomersScreen({ navigation }: P<"Customers">) {
  const { online } = useApp();
  const { user } = useAuth();
  const scope = user?.tenantId ?? user?.id ?? "anonymous";
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<RemoteCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      setLoading(true);
      setMessage(undefined);
      try {
        if (online && user) {
          const remote = await listRemoteCustomers(query, 80);
          if (active) setItems(remote);
        } else {
          const local = await listCachedCustomers(scope);
          const q = query.trim().toLowerCase();
          const filtered = q
            ? local.filter((item) => item.documentNumber.includes(q) || item.name.toLowerCase().includes(q))
            : local;
          if (active) {
            setItems(filtered.map((item) => ({
              id: `${item.documentType}:${item.documentNumber}`,
              tenantId: scope,
              documentType: item.documentType,
              documentNumber: item.documentNumber,
              fullName: item.name,
              address: item.address,
              phone: item.phone,
              email: item.email,
              dataSource: item.source ?? "CACHE_LOCAL"
            })));
            setMessage("Sin Internet: mostrando clientes guardados en este dispositivo.");
          }
        }
      } catch (error) {
        if (!active) return;
        setMessage(error instanceof Error ? error.message : "No pudimos cargar los clientes.");
      } finally {
        if (active) setLoading(false);
      }
    }, 250);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [online, query, scope, user]);

  return (
    <Screen title="Clientes" subtitle="Busca por DNI, RUC o nombre. Cada negocio conserva su propia cartera de clientes.">
      <TextField
        label="Buscar cliente"
        value={query}
        onChangeText={setQuery}
        placeholder="DNI, RUC o nombre"
        autoCapitalize="none"
      />

      <PrimaryButton label="＋ NUEVO CLIENTE" onPress={() => navigation.navigate("CustomerForm")} />

      {message ? <Card tone={online ? "warning" : "info"}><Text style={styles.helper}>{message}</Text></Card> : null}
      {loading ? <View style={styles.loading}><ActivityIndicator color={theme.colors.primary} /><Text style={styles.helper}>Cargando clientes…</Text></View> : null}

      {!loading && !items.length ? (
        <Card><Text style={styles.empty}>Aún no hay clientes que coincidan con la búsqueda.</Text></Card>
      ) : null}

      {items.map((customer) => (
        <Pressable
          key={customer.id}
          accessibilityRole="button"
          onPress={() => navigation.navigate("CustomerForm", { customer })}
        >
          <Card>
            <View style={styles.customerHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.customerName}>{customer.fullName}</Text>
                <Text style={styles.document}>{customer.documentType} {customer.documentNumber}</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </View>
            {customer.phone ? <InfoRow label="Teléfono" value={customer.phone} /> : null}
            {customer.email ? <InfoRow label="Email" value={customer.email} /> : null}
            {customer.address ? <InfoRow label="Dirección" value={customer.address} /> : null}
          </Card>
        </Pressable>
      ))}
    </Screen>
  );
}

export function CustomerFormScreen({ navigation, route }: P<"CustomerForm">) {
  const { online } = useApp();
  const { user } = useAuth();
  const scope = user?.tenantId ?? user?.id ?? "anonymous";
  const existing = route.params?.customer;
  const [documentType, setDocumentType] = useState<"DNI" | "RUC">(existing?.documentType ?? "DNI");
  const [documentNumber, setDocumentNumber] = useState(existing?.documentNumber ?? "");
  const [fullName, setFullName] = useState(existing?.fullName ?? "");
  const [address, setAddress] = useState(existing?.address ?? "");
  const [phone, setPhone] = useState(existing?.phone ?? "");
  const [email, setEmail] = useState(existing?.email ?? "");
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const expectedLength = documentType === "DNI" ? 8 : 11;
  const title = existing ? "Editar cliente" : "Nuevo cliente";

  const validEmail = useMemo(() => !email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()), [email]);

  function changeType(type: "DNI" | "RUC") {
    if (type === documentType) return;
    setDocumentType(type);
    setDocumentNumber("");
    setFullName("");
    setAddress("");
    setErrors({});
  }

  function validate() {
    const next: Record<string, string> = {};
    if (documentNumber.length !== expectedLength) next.document = documentType === "DNI" ? "El DNI debe tener 8 dígitos." : "El RUC debe tener 11 dígitos.";
    if (fullName.trim().length < 2) next.name = documentType === "DNI" ? "Ingresa el nombre del cliente." : "Ingresa la razón social.";
    if (!validEmail) next.email = "Ingresa un correo válido.";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function save() {
    if (!validate()) return;
    setSaving(true);
    try {
      const cached = {
        documentType,
        documentNumber,
        name: fullName.trim(),
        address: address.trim() || undefined,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        source: existing?.dataSource ?? "MANUAL",
        updatedAt: new Date().toISOString()
      } as const;
      await saveCachedCustomer(scope, cached);

      if (online && user) {
        await saveRemoteCustomer({
          documentType,
          documentNumber,
          fullName: fullName.trim(),
          address: address.trim() || undefined,
          phone: phone.trim() || undefined,
          email: email.trim() || undefined
        });
        showAlert("Cliente guardado", "Los datos quedaron guardados en el negocio.", [
          { text: "OK", onPress: () => navigation.goBack() }
        ]);
      } else {
        showAlert(
          "Cliente guardado en el dispositivo",
          "Cuando vuelva Internet lo sincronizaremos automáticamente con tu negocio.",
          [{ text: "OK", onPress: () => navigation.goBack() }]
        );
      }
    } catch (error) {
      showAlert("No pudimos guardar", error instanceof Error ? error.message : "Intenta nuevamente.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen title={title} subtitle="Consulta automáticamente el documento y completa manualmente solo lo necesario.">
      <View style={styles.chips}>
        <Chip label="DNI" active={documentType === "DNI"} onPress={() => changeType("DNI")} />
        <Chip label="RUC" active={documentType === "RUC"} onPress={() => changeType("RUC")} />
      </View>

      <CustomerDocumentLookupField
        tipoDoc={documentType}
        numero={documentNumber}
        nombre={fullName}
        online={online}
        onNumeroChange={(value) => {
          setDocumentNumber(value);
          setErrors((current) => ({ ...current, document: "" }));
        }}
        onNombreChange={(value) => {
          setFullName(value);
          setErrors((current) => ({ ...current, name: "" }));
        }}
        onResolved={(result) => {
          if (result.direccion && !address) setAddress(result.direccion);
        }}
      />
      {errors.document ? <Text style={styles.error}>{errors.document}</Text> : null}
      {errors.name ? <Text style={styles.error}>{errors.name}</Text> : null}

      <SectionTitle>Datos opcionales</SectionTitle>
      <TextField label="Dirección" value={address} onChangeText={setAddress} placeholder="Dirección del cliente" />
      <TextField label="Teléfono" value={phone} onChangeText={setPhone} placeholder="999 999 999" keyboardType="phone-pad" />
      <TextField
        label="Correo"
        value={email}
        onChangeText={(value) => {
          setEmail(value);
          setErrors((current) => ({ ...current, email: "" }));
        }}
        placeholder="cliente@correo.com"
        keyboardType="email-address"
        autoCapitalize="none"
        error={errors.email}
      />

      <Card tone={online ? "success" : "warning"}>
        <Text style={styles.helper}>{online
          ? "Se guardará en PostgreSQL y también en la caché del dispositivo para futuras ventas rápidas."
          : "Sin Internet: se guardará localmente y se sincronizará cuando vuelva la conexión."}</Text>
      </Card>

      <PrimaryButton label={saving ? "GUARDANDO…" : "GUARDAR CLIENTE"} onPress={() => void save()} disabled={saving} />
      <PrimaryButton label="CANCELAR" onPress={() => navigation.goBack()} tone="outline" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  loading: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  helper: { color: theme.colors.muted, lineHeight: 20 },
  empty: { color: theme.colors.muted, textAlign: "center" },
  customerHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  customerName: { color: theme.colors.text, fontSize: 16, fontWeight: "900" },
  document: { color: theme.colors.muted, marginTop: 4, fontSize: 12, fontWeight: "700" },
  chevron: { color: theme.colors.primaryText, fontSize: 26, fontWeight: "900" },
  chips: { flexDirection: "row", gap: 8 },
  error: { color: theme.colors.danger, fontSize: 13, fontWeight: "700", marginTop: -7 }
});
