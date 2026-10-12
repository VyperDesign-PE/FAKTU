import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/types";
import { Screen } from "../../components/Screen";
import { Card, Chip, InfoRow, PrimaryButton, SectionTitle, TextField } from "../../components/Ui";
import { showAlert } from "../../components/platform";
import { useApp } from "../../context/AppContext";
import {
  createGuide,
  getGuide,
  getRemoteBusiness,
  getRemoteReceiptByTransaction,
  listGuides,
  newTransactionId,
  refreshGuide,
  shareGuide,
  type GuideInput,
  type RemoteGuide
} from "../../services/api";
import { theme } from "../../theme";

type P<Name extends keyof RootStackParamList> = NativeStackScreenProps<RootStackParamList, Name>;

const REASONS = [
  { code: "01", label: "Venta" },
  { code: "04", label: "Entre mis locales" },
  { code: "02", label: "Compra" },
  { code: "06", label: "Devolución" },
  { code: "13", label: "Otros" }
];

const statusLabel = (status: RemoteGuide["status"]) => ({ ACCEPTED: "Aceptada", PENDING: "En proceso SUNAT", REJECTED: "Rechazada", ERROR: "Revisar" })[status];
const statusTone = (status: RemoteGuide["status"]) => (status === "ACCEPTED" ? "success" : status === "PENDING" ? "warning" : "danger") as "success" | "warning" | "danger";
const limaToday = () => new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 10);

export function GuidesScreen({ navigation }: P<"Guides">) {
  const { online } = useApp();
  const [guides, setGuides] = useState<RemoteGuide[]>();
  const [error, setError] = useState<string>();
  const load = useCallback(() => {
    if (!online) return setError("Necesitas Internet para ver tus guías.");
    listGuides().then(setGuides).catch((cause) => setError(cause instanceof Error ? cause.message : "No pudimos cargar las guías."));
  }, [online]);
  useEffect(() => navigation.addListener("focus", load), [navigation, load]);
  useEffect(load, [load]);

  return <Screen title="Guías de remisión" subtitle="Sustentan el traslado de mercadería ante SUNAT.">
    <PrimaryButton label="+ NUEVA GUÍA DE REMISIÓN" onPress={() => navigation.navigate("GuideForm", {})} disabled={!online} />
    {error ? <Card tone="danger"><Text>{error}</Text></Card> : null}
    {!guides && !error ? <ActivityIndicator color={theme.colors.primary} /> : null}
    {guides && !guides.length ? <Card><Text style={styles.muted}>Todavía no emites guías. Crea una cuando traslades mercadería (por ejemplo, al despachar una venta).</Text></Card> : null}
    {guides?.map((guide) => <Pressable key={guide.id} onPress={() => navigation.navigate("GuideDetail", { id: guide.id })}>
      <Card tone={statusTone(guide.status)}>
        <InfoRow label={guide.guideType === "REMITENTE" ? "Remitente" : "Transportista"} value={guide.number} />
        <InfoRow label="Destinatario" value={guide.data.recipient.name} />
        <InfoRow label={`Traslado ${guide.transferDate}`} value={statusLabel(guide.status)} />
      </Card>
    </Pressable>)}
  </Screen>;
}

export function GuideFormScreen({ navigation, route }: P<"GuideForm">) {
  const { online, profile } = useApp();
  const [transactionId] = useState(() => newTransactionId("guia"));
  const [guideType, setGuideType] = useState<GuideInput["guideType"]>("REMITENTE");
  const [relatedReceiptId, setRelatedReceiptId] = useState<string>();
  const [recipientType, setRecipientType] = useState<"6" | "1">("6");
  const [recipientNumber, setRecipientNumber] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [shipperNumber, setShipperNumber] = useState("");
  const [shipperName, setShipperName] = useState("");
  const [reasonCode, setReasonCode] = useState("01");
  const [reasonDescription, setReasonDescription] = useState("");
  const [mode, setMode] = useState<"01" | "02">("02");
  const [transferDate, setTransferDate] = useState(limaToday());
  const [weight, setWeight] = useState("");
  const [packages, setPackages] = useState("1");
  const [originUbigeo, setOriginUbigeo] = useState(profile.ubigeo ?? "");
  const [originAddress, setOriginAddress] = useState(profile.address ?? "");
  const [destinationUbigeo, setDestinationUbigeo] = useState("");
  const [destinationAddress, setDestinationAddress] = useState("");
  const [carrierRuc, setCarrierRuc] = useState("");
  const [carrierName, setCarrierName] = useState("");
  const [plate, setPlate] = useState("");
  const [driverDni, setDriverDni] = useState("");
  const [driverNames, setDriverNames] = useState("");
  const [driverSurnames, setDriverSurnames] = useState("");
  const [driverLicense, setDriverLicense] = useState("");
  const [items, setItems] = useState<Array<{ description: string; quantity: string; unit: string }>>([{ description: "", quantity: "1", unit: "NIU" }]);
  const [busy, setBusy] = useState(false);

  // Prellenado: punto de partida desde el negocio y, si viene de una venta,
  // destinatario y productos desde el comprobante.
  useEffect(() => {
    getRemoteBusiness().then((business) => {
      if (business.ubigeo) setOriginUbigeo((current) => current || business.ubigeo || "");
      if (business.address) setOriginAddress((current) => current || business.address || "");
    }).catch(() => undefined);
    const tx = route.params?.receiptClientTransactionId;
    if (!tx) return;
    getRemoteReceiptByTransaction(tx).then((receipt) => {
      setRelatedReceiptId(receipt.id);
      if (receipt.customer?.documentNumber) {
        setRecipientType(receipt.customer.documentType === "DNI" ? "1" : "6");
        setRecipientNumber(receipt.customer.documentNumber);
        setRecipientName(receipt.customer.name ?? "");
      }
      if (receipt.customer?.address) setDestinationAddress(receipt.customer.address);
      if (receipt.items?.length) setItems(receipt.items.map((item) => ({ description: item.name, quantity: String(item.quantity), unit: item.unit === "ZZ" ? "ZZ" : "NIU" })));
    }).catch(() => undefined);
  }, [route.params?.receiptClientTransactionId]);

  const ownVehicle = guideType === "TRANSPORTISTA" || mode === "02";

  async function submit() {
    const fail = (title: string, message: string) => showAlert(title, message);
    if (!recipientNumber.trim() || !recipientName.trim()) return fail("Destinatario", "Completa el documento y el nombre del destinatario.");
    if (guideType === "TRANSPORTISTA" && (!shipperNumber.trim() || !shipperName.trim())) return fail("Remitente", "Completa los datos de quien envía la mercadería.");
    if (!/^\d{6}$/.test(originUbigeo) || !/^\d{6}$/.test(destinationUbigeo)) return fail("Ubigeo", "El ubigeo tiene 6 dígitos (ej. 150101 = Lima, Lima, Lima).");
    if (!originAddress.trim() || !destinationAddress.trim()) return fail("Direcciones", "Completa las direcciones de partida y llegada.");
    const grossWeight = Number(weight.replace(",", "."));
    if (!(grossWeight > 0)) return fail("Peso", "Indica el peso bruto total en kilogramos.");
    const cleanItems = items.filter((item) => item.description.trim()).map((item) => ({ description: item.description.trim(), quantity: Number(item.quantity.replace(",", ".")), unit: item.unit }));
    if (!cleanItems.length || cleanItems.some((item) => !(item.quantity > 0))) return fail("Bienes", "Agrega al menos un bien con su cantidad.");
    if (guideType === "REMITENTE" && mode === "01" && (!/^\d{11}$/.test(carrierRuc) || !carrierName.trim())) return fail("Transportista", "Indica el RUC y la razón social de la empresa de transportes.");
    if (ownVehicle && (!plate.trim() || !/^\d{8}$/.test(driverDni) || !driverNames.trim() || !driverSurnames.trim() || !driverLicense.trim())) {
      return fail("Vehículo y conductor", "Completa la placa y los datos del conductor (DNI, nombres, apellidos y licencia).");
    }

    const input: GuideInput = {
      clientTransactionId: transactionId,
      guideType,
      relatedReceiptId,
      data: {
        recipient: { documentType: recipientType, documentNumber: recipientNumber.trim(), name: recipientName.trim() },
        ...(guideType === "TRANSPORTISTA" ? { shipper: { documentType: "6" as const, documentNumber: shipperNumber.trim(), name: shipperName.trim() } } : {}),
        ...(guideType === "REMITENTE" ? { reasonCode, reasonDescription: reasonCode === "13" ? reasonDescription.trim() : undefined, transportMode: mode, packages: Math.max(1, Number(packages) || 1) } : {}),
        transferDate,
        grossWeight,
        weightUnit: "KGM",
        origin: { ubigeo: originUbigeo, address: originAddress.trim() },
        destination: { ubigeo: destinationUbigeo, address: destinationAddress.trim() },
        ...(guideType === "REMITENTE" && mode === "01" ? { carrier: { documentNumber: carrierRuc, name: carrierName.trim() } } : {}),
        ...(ownVehicle ? { vehiclePlate: plate.trim(), driver: { documentType: "1" as const, documentNumber: driverDni, names: driverNames.trim(), surnames: driverSurnames.trim(), license: driverLicense.trim() } } : {}),
        items: cleanItems
      }
    };
    setBusy(true);
    try {
      const guide = await createGuide(input);
      navigation.replace("GuideDetail", { id: guide.id });
    } catch (cause) {
      showAlert("No pudimos emitir la guía", cause instanceof Error ? cause.message : "Intenta nuevamente.");
    } finally {
      setBusy(false);
    }
  }

  return <Screen title="Nueva guía de remisión" subtitle={relatedReceiptId ? "Prellenada con los datos de la venta." : "Para trasladar mercadería con sustento ante SUNAT."}>
    <View style={styles.chips}>
      <Chip label="Remitente (mi mercadería)" active={guideType === "REMITENTE"} onPress={() => setGuideType("REMITENTE")} />
      <Chip label="Transportista (llevo carga de otros)" active={guideType === "TRANSPORTISTA"} onPress={() => setGuideType("TRANSPORTISTA")} />
    </View>

    <SectionTitle>Destinatario</SectionTitle>
    <View style={styles.chips}>
      <Chip label="RUC" active={recipientType === "6"} onPress={() => setRecipientType("6")} />
      <Chip label="DNI" active={recipientType === "1"} onPress={() => setRecipientType("1")} />
    </View>
    <TextField label={recipientType === "6" ? "RUC del destinatario" : "DNI del destinatario"} value={recipientNumber} onChangeText={setRecipientNumber} keyboardType="number-pad" />
    <TextField label="Nombre o razón social" value={recipientName} onChangeText={setRecipientName} />

    {guideType === "TRANSPORTISTA" ? <>
      <SectionTitle>Remitente (quien envía)</SectionTitle>
      <TextField label="RUC del remitente" value={shipperNumber} onChangeText={setShipperNumber} keyboardType="number-pad" />
      <TextField label="Razón social del remitente" value={shipperName} onChangeText={setShipperName} />
    </> : <>
      <SectionTitle>Motivo del traslado</SectionTitle>
      <View style={styles.chips}>{REASONS.map((reason) => <Chip key={reason.code} label={reason.label} active={reasonCode === reason.code} onPress={() => setReasonCode(reason.code)} />)}</View>
      {reasonCode === "13" ? <TextField label="Describe el motivo" value={reasonDescription} onChangeText={setReasonDescription} /> : null}
      <SectionTitle>¿Quién transporta?</SectionTitle>
      <View style={styles.chips}>
        <Chip label="Yo mismo (privado)" active={mode === "02"} onPress={() => setMode("02")} />
        <Chip label="Empresa de transportes (público)" active={mode === "01"} onPress={() => setMode("01")} />
      </View>
    </>}

    <SectionTitle>Traslado</SectionTitle>
    <TextField label="Fecha de inicio (AAAA-MM-DD)" value={transferDate} onChangeText={setTransferDate} />
    <TextField label="Peso bruto total (kg)" value={weight} onChangeText={setWeight} keyboardType="decimal-pad" placeholder="Ej. 12.5" />
    {guideType === "REMITENTE" ? <TextField label="Número de bultos" value={packages} onChangeText={setPackages} keyboardType="number-pad" /> : null}
    <TextField label="Ubigeo de partida (6 dígitos)" value={originUbigeo} onChangeText={setOriginUbigeo} keyboardType="number-pad" placeholder="150101" />
    <TextField label="Dirección de partida" value={originAddress} onChangeText={setOriginAddress} />
    <TextField label="Ubigeo de llegada (6 dígitos)" value={destinationUbigeo} onChangeText={setDestinationUbigeo} keyboardType="number-pad" placeholder="150122" />
    <TextField label="Dirección de llegada" value={destinationAddress} onChangeText={setDestinationAddress} />
    <Text style={styles.muted}>El ubigeo es el código del distrito (INEI). Ej.: 150101 Lima, 150122 Miraflores, 150140 Santiago de Surco.</Text>

    {guideType === "REMITENTE" && mode === "01" ? <>
      <SectionTitle>Empresa de transportes</SectionTitle>
      <TextField label="RUC de la empresa" value={carrierRuc} onChangeText={setCarrierRuc} keyboardType="number-pad" />
      <TextField label="Razón social" value={carrierName} onChangeText={setCarrierName} />
    </> : null}

    {ownVehicle ? <>
      <SectionTitle>Vehículo y conductor</SectionTitle>
      <TextField label="Placa" value={plate} onChangeText={setPlate} autoCapitalize="characters" placeholder="ABC123" />
      <TextField label="DNI del conductor" value={driverDni} onChangeText={setDriverDni} keyboardType="number-pad" />
      <TextField label="Nombres del conductor" value={driverNames} onChangeText={setDriverNames} />
      <TextField label="Apellidos del conductor" value={driverSurnames} onChangeText={setDriverSurnames} />
      <TextField label="Licencia de conducir" value={driverLicense} onChangeText={setDriverLicense} autoCapitalize="characters" />
    </> : null}

    <SectionTitle>Bienes trasladados</SectionTitle>
    {items.map((item, index) => <Card key={index}>
      <TextField label="Descripción" value={item.description} onChangeText={(value) => setItems((list) => list.map((it, i) => (i === index ? { ...it, description: value } : it)))} />
      <TextField label="Cantidad" value={item.quantity} onChangeText={(value) => setItems((list) => list.map((it, i) => (i === index ? { ...it, quantity: value } : it)))} keyboardType="decimal-pad" />
      {items.length > 1 ? <PrimaryButton label="QUITAR" tone="outline" onPress={() => setItems((list) => list.filter((_, i) => i !== index))} /> : null}
    </Card>)}
    <PrimaryButton label="+ AGREGAR BIEN" tone="outline" onPress={() => setItems((list) => [...list, { description: "", quantity: "1", unit: "NIU" }])} />

    <PrimaryButton label={busy ? "EMITIENDO..." : "EMITIR GUÍA DE REMISIÓN"} onPress={() => void submit()} disabled={busy || !online} />
  </Screen>;
}

export function GuideDetailScreen({ route }: P<"GuideDetail">) {
  const { online } = useApp();
  const [guide, setGuide] = useState<RemoteGuide>();
  const [busy, setBusy] = useState(false);
  useEffect(() => { getGuide(route.params.id).then(setGuide).catch(() => undefined); }, [route.params.id]);

  async function refresh() {
    setBusy(true);
    try { setGuide(await refreshGuide(route.params.id)); }
    catch (cause) { showAlert("No pudimos consultar la guía", cause instanceof Error ? cause.message : "Intenta nuevamente."); }
    finally { setBusy(false); }
  }

  async function openPdf() {
    try { await Linking.openURL((await shareGuide(route.params.id)).pdfUrl); }
    catch (cause) { showAlert("No pudimos abrir la guía", cause instanceof Error ? cause.message : "Intenta nuevamente."); }
  }

  if (!guide) return <Screen title="Guía de remisión"><ActivityIndicator color={theme.colors.primary} /></Screen>;
  const d = guide.data;
  return <Screen title="Guía de remisión" subtitle={guide.number}>
    <Card tone={statusTone(guide.status)}>
      <InfoRow label="Estado" value={statusLabel(guide.status)} />
      <InfoRow label="Tipo" value={guide.guideType === "REMITENTE" ? "Remitente" : "Transportista"} />
      <InfoRow label="Inicio de traslado" value={guide.transferDate} />
      <InfoRow label="Destinatario" value={d.recipient.name} />
      <InfoRow label="Peso" value={`${d.grossWeight} kg`} />
    </Card>
    {guide.practice ? <Card tone="warning"><Text style={styles.muted}>Guía de práctica: no tiene validez ante SUNAT.</Text></Card> : null}
    {guide.message ? <Card tone={guide.status === "REJECTED" || guide.status === "ERROR" ? "danger" : "info"}><Text>{guide.message}</Text></Card> : null}
    <Card>
      <InfoRow label="Partida" value={`${d.origin.address} (${d.origin.ubigeo})`} />
      <InfoRow label="Llegada" value={`${d.destination.address} (${d.destination.ubigeo})`} />
      {d.vehiclePlate ? <InfoRow label="Vehículo" value={d.vehiclePlate} /> : null}
      {d.carrier ? <InfoRow label="Transportista" value={d.carrier.name} /> : null}
    </Card>
    <SectionTitle>Bienes</SectionTitle>
    <Card>{d.items.map((item, index) => <InfoRow key={index} label={item.description} value={`${item.quantity} ${item.unit}`} />)}</Card>
    {guide.status === "PENDING" || guide.status === "ERROR" ? <>
      <Text style={styles.muted}>SUNAT acepta las guías en unos minutos. FAKTU lo revisa automáticamente; también puedes consultar ahora.</Text>
      <PrimaryButton label={busy ? "CONSULTANDO..." : "CONSULTAR ESTADO EN SUNAT"} onPress={() => void refresh()} disabled={busy || !online} />
    </> : null}
    {guide.status === "ACCEPTED" ? <PrimaryButton label="VER / COMPARTIR PDF" onPress={() => void openPdf()} tone="success" /> : null}
  </Screen>;
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  muted: { color: theme.colors.muted, lineHeight: 20 }
});
