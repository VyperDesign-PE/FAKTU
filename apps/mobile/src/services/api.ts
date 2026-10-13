import type { AuthSession } from "../auth/types";
import { DOCUMENT_LENGTH } from "../domain/documentRules";
import type { BusinessProfile, PaymentMethod, PendingReceipt, Product } from "../domain/types";
import { clearSession, getAccessToken, loadSession, notifySessionInvalid, saveSession } from "../storage/session";

import { Platform } from "react-native";

/**
 * En la web la app la sirve la misma API (mismo dominio), así que basta el
 * origen actual. En el celular se configura EXPO_PUBLIC_API_URL; el valor por
 * defecto apunta al emulador de Android en desarrollo.
 */
export const API_URL = process.env.EXPO_PUBLIC_API_URL?.trim()
  || (Platform.OS === "web" && typeof window !== "undefined" ? window.location.origin : "http://10.0.2.2:4000");

async function json<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body as { message?: string }).message ?? "No pudimos completar la operación");
  return body as T;
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

let refreshing: Promise<boolean> | null = null;

/**
 * Renueva la sesión con el token rotativo. Una sola renovación a la vez: si
 * varias llamadas reciben 401 juntas, todas esperan la misma.
 */
async function refreshSession(): Promise<boolean> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const current = await loadSession();
    if (!current?.refreshToken) return false;
    try {
      const response = await fetch(`${API_URL}/v1/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: current.refreshToken })
      });
      if (response.status === 401 || response.status === 400) {
        await clearSession();
        notifySessionInvalid();
        return false;
      }
      if (!response.ok) return false;
      await saveSession(await response.json() as AuthSession);
      return true;
    } catch {
      // Sin conexión: se conserva la sesión para reintentar cuando vuelva Internet.
      return false;
    }
  })().finally(() => { refreshing = null; });
  return refreshing;
}

async function authorizedFetch(path: string, init: RequestInit = {}) {
  const send = async () => fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(await authHeaders()),
      ...(init.headers ?? {})
    }
  });
  const response = await send();
  if (response.status !== 401) return response;
  return (await refreshSession()) ? send() : response;
}

export async function logoutRemote() {
  await authorizedFetch("/v1/auth/logout", { method: "POST" }).catch(() => undefined);
}

export async function logoutAllDevices() {
  return json<{ ok: true }>(await authorizedFetch("/v1/auth/logout-all", { method: "POST" }));
}

export async function getPublicConfig() {
  return json<{ demo: { email: string; password: string; business: string } | null }>(await fetch(`${API_URL}/v1/public-config`));
}

export type LoginResult = AuthSession | { mfaRequired: true; mfaToken: string };

export async function loginWithEmail(email: string, password: string) {
  return json<LoginResult>(await fetch(`${API_URL}/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  }));
}

export async function verifyMfaLogin(mfaToken: string, code: string) {
  return json<AuthSession>(await fetch(`${API_URL}/v1/auth/mfa/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mfaToken, code })
  }));
}

export async function getMfaStatus() {
  return json<{ enabled: boolean; recoveryCodesLeft?: number }>(await authorizedFetch("/v1/auth/mfa/status"));
}

export async function startMfaSetup() {
  return json<{ secret: string; otpauthUrl: string }>(await authorizedFetch("/v1/auth/mfa/setup", { method: "POST" }));
}

export async function enableMfa(code: string) {
  return json<{ enabled: boolean; recoveryCodes: string[] }>(await authorizedFetch("/v1/auth/mfa/enable", { method: "POST", body: JSON.stringify({ code }) }));
}

export async function disableMfa(code: string) {
  return json<{ enabled: boolean }>(await authorizedFetch("/v1/auth/mfa/disable", { method: "POST", body: JSON.stringify({ code }) }));
}

export type AuditEntry = { id: number; action: string; entityType?: string; entityId?: string; ip?: string; createdAt: string };

export async function listAuditLog() {
  return json<AuditEntry[]>(await authorizedFetch("/v1/audit"));
}

export async function registerWithEmail(email: string, password: string) {
  return json<AuthSession>(await fetch(`${API_URL}/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  }));
}

export async function requestOtp(phone: string) {
  return json<{ ok: true; verificationRequired?: boolean; devCode?: string }>(await authorizedFetch("/v1/auth/otp/request", {
    method: "POST",
    body: JSON.stringify({ phone })
  }));
}

export async function verifyOtp(phone: string, code: string) {
  return json<{ ok: true }>(await authorizedFetch("/v1/auth/otp/verify", {
    method: "POST",
    body: JSON.stringify({ phone, code })
  }));
}

export async function lookupTaxpayer(ruc: string) {
  return json<{ ruc: string; businessName: string; tradeName?: string; status: string; address: string; source?: string; sourceUpdatedAt?: string; simulated?: boolean }>(
    await authorizedFetch(`/v1/taxpayers/${ruc}`)
  );
}

export type CustomerLookupResult = {
  tipoDoc: "DNI" | "RUC";
  numero: string;
  nombreCompleto: string;
  direccion?: string;
  estado?: string;
  condicion?: string;
  source: "MOCK" | "APIPERU_DEV" | "EXTERNAL" | "CACHE_SERVER" | "SUNAT_RUC_PADRON";
  sourceUpdatedAt?: string;
  originalSource?: string;
  customerId?: string;
};

export async function consultarDocumentoCliente(tipoDoc: "DNI" | "RUC", numero: string) {
  const clean = numero.replace(/\D/g, "");
  if (clean.length !== DOCUMENT_LENGTH[tipoDoc]) {
    throw new Error(tipoDoc === "DNI" ? "El DNI debe tener 8 dígitos." : "El RUC debe tener 11 dígitos.");
  }

  return json<CustomerLookupResult>(await authorizedFetch("/v1/customers/lookup", {
    method: "POST",
    body: JSON.stringify({ tipoDoc, numero: clean })
  }));
}

export type RemoteCustomer = {
  id: string;
  tenantId: string;
  documentType: "DNI" | "RUC";
  documentNumber: string;
  fullName: string;
  address?: string;
  phone?: string;
  email?: string;
  dataSource: string;
  verifiedAt?: string;
};

export async function listRemoteCustomers(query = "", limit = 50) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (query.trim()) params.set("q", query.trim());
  return json<RemoteCustomer[]>(await authorizedFetch(`/v1/customers?${params.toString()}`));
}

export async function saveRemoteCustomer(input: {
  documentType: "DNI" | "RUC";
  documentNumber: string;
  fullName: string;
  address?: string;
  phone?: string;
  email?: string;
}) {
  return json<RemoteCustomer>(await authorizedFetch("/v1/customers", {
    method: "POST",
    body: JSON.stringify(input)
  }));
}

export async function getRemoteBusiness(): Promise<BusinessProfile> {
  const business = await json<{
    ruc?: string;
    businessName?: string;
    tradeName?: string;
    address?: string;
    ubigeo?: string;
    phone?: string;
    taxpayerStatus?: string;
    onboardingComplete?: boolean;
  }>(await authorizedFetch("/v1/business"));
  return {
    ruc: business.ruc,
    businessName: business.businessName,
    tradeName: business.tradeName,
    address: business.address,
    ubigeo: business.ubigeo,
    phone: business.phone,
    taxpayerStatus: business.taxpayerStatus,
    onboardingComplete: Boolean(business.onboardingComplete)
  };
}

export async function updateRemoteBusiness(profile: BusinessProfile) {
  return json<BusinessProfile>(await authorizedFetch("/v1/business", {
    method: "PATCH",
    body: JSON.stringify({
      ruc: profile.ruc,
      businessName: profile.businessName,
      tradeName: profile.tradeName,
      address: profile.address,
      ...(profile.ubigeo && /^d{6}$/.test(profile.ubigeo) ? { ubigeo: profile.ubigeo } : {}),
      phone: profile.phone,
      taxpayerStatus: profile.taxpayerStatus,
      // Un dispositivo nuevo (perfil local vacío) nunca debe "des-completar" el alta hecha en otro.
      ...(profile.onboardingComplete ? { onboardingComplete: true } : {})
    })
  }));
}

export async function listRemoteProducts(): Promise<Product[]> {
  const rows = await json<Array<{ clientProductId: string; name: string; unitPrice: number; unitCode: string; favorite: boolean; stockQty: number | null; minStock: number }>>(
    await authorizedFetch("/v1/products")
  );
  return rows.map((row) => ({ id: row.clientProductId, name: row.name, unitPrice: row.unitPrice, unit: row.unitCode, favorite: row.favorite, stockQty: row.stockQty, minStock: row.minStock }));
}

export async function upsertRemoteProduct(product: Product) {
  return json(await authorizedFetch(`/v1/products/${encodeURIComponent(product.id)}`, {
    method: "PUT",
    body: JSON.stringify({ name: product.name, unitPrice: product.unitPrice, unitCode: product.unit, favorite: product.favorite, ...(product.minStock !== undefined ? { minStock: product.minStock } : {}) })
  }));
}

export async function deleteRemoteProduct(id: string) {
  const response = await authorizedFetch(`/v1/products/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!response.ok) await json(response);
}

export async function adjustRemoteStock(id: string, mode: "SET" | "ADD", quantity: number, note?: string) {
  return json<{ stockQty: number }>(await authorizedFetch(`/v1/products/${encodeURIComponent(id)}/stock`, {
    method: "POST",
    body: JSON.stringify({ mode, quantity, ...(note ? { note } : {}) })
  }));
}

export type StockMovement = { id: string; delta: number; balance: number; reason: string; note?: string; createdAt: string };

export async function listStockMovements(id: string) {
  return json<StockMovement[]>(await authorizedFetch(`/v1/products/${encodeURIComponent(id)}/movements`));
}

export type Insights = {
  date: string;
  today: { total: number; count: number };
  yesterday: number;
  sameDayLastWeek: number;
  week: { total: number; series: Array<{ date: string; total: number; count: number }> };
  topProducts: Array<{ name: string; quantity: number; revenue: number }>;
  peakHour: number | null;
  paymentMix: Array<{ method: string; total: number }>;
  lowStock: Array<{ clientProductId: string; name: string; stockQty: number; minStock: number }>;
  receivables: { total: number; customers: number; oldestDays: number };
};

export async function getInsights() {
  return json<Insights>(await authorizedFetch("/v1/insights"));
}

export type Receivable = {
  receiptId: string;
  clientTransactionId: string;
  number: string;
  issueDate: string;
  total: number;
  paid: number;
  balance: number;
  customerName: string;
  customerDocument?: string;
  customerPhone?: string;
};

export async function listReceivables() {
  return json<Receivable[]>(await authorizedFetch("/v1/receivables"));
}

export async function payReceivable(receiptId: string, amount: number, method: PaymentMethod) {
  return json<{ balance: number }>(await authorizedFetch(`/v1/receivables/${receiptId}/payments`, {
    method: "POST",
    body: JSON.stringify({ amount, method })
  }));
}

export type RemoteReceipt = {
  id: string;
  clientTransactionId: string;
  temporaryNumber: string;
  documentType: "BOLETA" | "FACTURA" | "NOTA_CREDITO" | "NOTA_DEBITO";
  paymentMethod?: PaymentMethod;
  noteReasonCode?: string;
  noteDescription?: string;
  practice?: boolean;
  creditedTotal?: number;
  debitedTotal?: number;
  /** Saldo que aún puede acreditarse con notas de crédito. */
  creditableBalance?: number;
  voiding?: { id: string; status: string; kind: string };
  /** Motivos por los que no puede darse de baja (vacío = sí puede). */
  voidingBlockers?: string[];
  amountReceived?: number;
  changeAmount?: number;
  relatedReceiptId?: string;
  creditNoteReason?: string;
  /** true cuando una nota de crédito aceptada anuló el comprobante. */
  voided?: boolean;
  creditNote?: { id: string; status: "ACCEPTED" | "PENDING" | "REJECTED" | "ERROR"; officialNumber?: string };
  series: string;
  correlative: number;
  officialNumber?: string;
  issueDate: string;
  subtotal: number;
  igv: number;
  total: number;
  status: "ACCEPTED" | "PENDING" | "REJECTED" | "ERROR";
  sunatStatus: string;
  customer?: { documentType?: "DNI" | "RUC"; documentNumber?: string; name?: string; address?: string };
  message?: string;
  items?: Array<{ id: string; name: string; quantity: number; unitPrice: number; unit?: string }>;
};

export type SubmitReceiptResult = {
  clientTransactionId: string;
  officialNumber?: string;
  status: "ACCEPTED" | "PENDING" | "REJECTED" | "ERROR";
  message?: string;
  providerCode?: string;
};

/**
 * Envía una venta. El servidor responde con el estado del comprobante también
 * en 202 (pendiente), 422 (rechazado) y 503 (error del proveedor), así que se
 * lee el cuerpo antes de decidir. Solo lanza excepción cuando vale la pena
 * reintentar (sin red, sesión vencida, error inesperado del servidor).
 */
export async function submitReceipt(receipt: PendingReceipt): Promise<SubmitReceiptResult> {
  const response = await authorizedFetch("/v1/receipts", { method: "POST", body: JSON.stringify(receipt) });
  const body = await response.json().catch(() => ({})) as Partial<SubmitReceiptResult> & { retryable?: boolean };
  if (body.status) return { clientTransactionId: receipt.clientTransactionId, ...body } as SubmitReceiptResult;
  if (response.status >= 400 && response.status < 500 && body.retryable === false) {
    return { clientTransactionId: receipt.clientTransactionId, status: "REJECTED", message: body.message ?? "La venta no es válida." };
  }
  throw new Error(body.message ?? "No pudimos enviar el comprobante.");
}

export async function listRemoteReceipts(limit = 100) {
  return json<RemoteReceipt[]>(await authorizedFetch(`/v1/receipts?limit=${Math.min(Math.max(limit, 1), 200)}`));
}

export async function getRemoteReceiptByTransaction(clientTransactionId: string) {
  return json<RemoteReceipt>(await authorizedFetch(`/v1/receipts/by-transaction/${encodeURIComponent(clientTransactionId)}`));
}

export type ReceiptSharePackage = {
  documentType: "BOLETA" | "FACTURA";
  documentNumber: string;
  total: number;
  viewUrl: string;
  pdfUrl: string;
  whatsappText: string;
  emailSubject: string;
  emailBody: string;
  expiresAt: string;
};

export async function createReceiptSharePackage(clientTransactionId: string) {
  return json<ReceiptSharePackage>(await authorizedFetch(`/v1/receipts/by-transaction/${encodeURIComponent(clientTransactionId)}/share`, { method: "POST" }));
}

export async function getLookupSummary() {
  return json<{ totalLookups: number; externalLookups: number; cacheHits: number; estimatedCost: number }>(
    await authorizedFetch("/v1/customer-lookups/summary")
  );
}

export async function getSubscription() {
  return json<{ plan_code: string; status: string; trial_ends_at?: string; current_period_end?: string }>(await authorizedFetch("/v1/subscription"));
}

export type BillingProviderCode = "mock" | "apisperu" | "nubefact" | "efact" | "senda" | "facturadorpe" | "cpeapi" | "external";
export type BillingEnvironment = "sandbox" | "production";
export type BillingProviderOption = { code: BillingProviderCode; name: string; note: string; /** false = solo sonda de salud, aún no emite. */ canIssue?: boolean };
export type BillingSettings = {
  tenantId: string;
  providerCode: BillingProviderCode;
  environment: BillingEnvironment;
  providerAccountRef?: string;
  credentialConfigured: boolean;
  connectionStatus: "NOT_TESTED" | "CONNECTED" | "ERROR";
  lastTestedAt?: string;
  lastError?: string;
};

export async function listBillingProviders() {
  return json<{ providers: BillingProviderOption[] }>(await authorizedFetch("/v1/billing/providers"));
}

export async function getBillingSettings() {
  return json<BillingSettings>(await authorizedFetch("/v1/billing/settings"));
}

export async function updateBillingSettings(input: { providerCode: BillingProviderCode; environment: BillingEnvironment; providerAccountRef?: string }) {
  return json<BillingSettings>(await authorizedFetch("/v1/billing/settings", { method: "PATCH", body: JSON.stringify(input) }));
}

export async function testBillingConnection() {
  return json<{ ok: boolean; status?: string; provider?: string; message: string }>(await authorizedFetch("/v1/billing/test-connection", { method: "POST" }));
}

export async function beginPseAuthorization() {
  return json<{ mode: string; authorizationUrl: string; message: string }>(await authorizedFetch("/v1/pse/authorization-session", { method: "POST" }));
}

export type ReceiptDelivery = {
  id: string;
  tenantId: string;
  receiptId: string;
  channel: "WHATSAPP" | "EMAIL" | "SMS";
  destination: string;
  status: "WAITING_RECEIPT" | "PENDING" | "PROCESSING" | "SENT" | "FAILED" | "CANCELLED";
  attemptCount: number;
  providerCode?: string;
  providerMessageId?: string;
  lastError?: string;
  sentAt?: string;
};

export async function queueAutomaticDelivery(
  clientTransactionId: string,
  channel: "WHATSAPP" | "EMAIL" | "SMS",
  destination: string
) {
  return json<ReceiptDelivery>(await authorizedFetch(
    `/v1/receipts/by-transaction/${encodeURIComponent(clientTransactionId)}/deliveries`,
    { method: "POST", body: JSON.stringify({ channel, destination }) }
  ));
}

export async function listReceiptDeliveries(limit = 100) {
  return json<ReceiptDelivery[]>(await authorizedFetch(`/v1/deliveries?limit=${Math.min(Math.max(limit, 1), 200)}`));
}

export type RucRegistryStatus = {
  ready: boolean;
  rowCount: number;
  sourceUpdatedAt?: string;
  importedAt?: string;
  lastRun?: {
    status: "RUNNING" | "COMPLETED" | "FAILED";
    rowCount: number;
    sourceUpdatedAt?: string;
    startedAt: string;
    completedAt?: string;
    errorMessage?: string;
  };
};

export async function getRucRegistryStatus() {
  return json<RucRegistryStatus>(await authorizedFetch("/v1/system/ruc-registry/status"));
}

/**
 * Anula un comprobante aceptado emitiendo una nota de crédito (motivo 01).
 * Repetir la llamada devuelve la misma nota de crédito.
 */
export async function voidReceipt(receiptId: string, reason: string): Promise<RemoteReceipt> {
  const response = await authorizedFetch(`/v1/receipts/${encodeURIComponent(receiptId)}/void`, { method: "POST", body: JSON.stringify({ reason }) });
  const body = await response.json().catch(() => ({})) as Partial<RemoteReceipt> & { message?: string };
  if (body.status) return body as RemoteReceipt;
  throw new Error(body.message ?? "No pudimos anular el comprobante.");
}

export type DailyClose = {
  date: string;
  sales: { count: number; total: number };
  accepted: { count: number; total: number };
  pending: { count: number; total: number };
  rejected: { count: number; total: number };
  creditNotes: { count: number; total: number };
  debitNotes?: { count: number; total: number };
  voidings?: { count: number; total: number };
  netTotal: number;
  expectedCash: number;
  receivableCollections?: Array<{ method: string; total: number; count: number }>;
  byDocumentType: { BOLETA: { count: number; total: number }; FACTURA: { count: number; total: number } };
  paymentMethods: Array<{ method: PaymentMethod; salesCount: number; sales: number; refunds: number; net: number }>;
};

export async function getDailyClose(date?: string) {
  return json<DailyClose>(await authorizedFetch(`/v1/reports/daily-close${date ? `?date=${encodeURIComponent(date)}` : ""}`));
}

/** Enlace temporal (10 min) para descargar el registro de ventas del mes en CSV. */
export async function createSalesRegisterLink(month: string) {
  return json<{ url: string; expiresInSeconds: number }>(await authorizedFetch("/v1/reports/sales-register/link", {
    method: "POST",
    body: JSON.stringify({ month })
  }));
}

// ---------- Notas de crédito / débito y bajas ----------

export const CREDIT_NOTE_OPTIONS = [
  { code: "01", label: "Anular toda la venta" },
  { code: "07", label: "Devolución de productos" },
  { code: "09", label: "Descuento o rebaja" },
  { code: "02", label: "Error en el RUC" },
  { code: "06", label: "Devolución total" }
] as const;
export type CreditNoteCode = (typeof CREDIT_NOTE_OPTIONS)[number]["code"];

export const DEBIT_NOTE_OPTIONS = [
  { code: "01", label: "Intereses por mora" },
  { code: "02", label: "Aumento en el valor" },
  { code: "03", label: "Penalidad u otro concepto" }
] as const;
export type DebitNoteCode = (typeof DEBIT_NOTE_OPTIONS)[number]["code"];

async function receiptOrThrow(response: Response, fallback: string): Promise<RemoteReceipt> {
  const body = await response.json().catch(() => ({})) as Partial<RemoteReceipt> & { message?: string };
  if (body.status && body.id) return body as RemoteReceipt;
  throw new Error(body.message ?? fallback);
}

export async function createCreditNote(receiptId: string, input: {
  reasonCode: CreditNoteCode;
  description?: string;
  items?: Array<{ lineIndex: number; quantity: number }>;
  amount?: number;
  clientTransactionId?: string;
}) {
  return receiptOrThrow(
    await authorizedFetch(`/v1/receipts/${encodeURIComponent(receiptId)}/credit-notes`, { method: "POST", body: JSON.stringify(input) }),
    "No pudimos emitir la nota de crédito."
  );
}

export async function createDebitNote(receiptId: string, input: {
  reasonCode: DebitNoteCode;
  description?: string;
  items: Array<{ name: string; quantity: number; unitPrice: number }>;
  clientTransactionId?: string;
}) {
  return receiptOrThrow(
    await authorizedFetch(`/v1/receipts/${encodeURIComponent(receiptId)}/debit-notes`, { method: "POST", body: JSON.stringify(input) }),
    "No pudimos emitir la nota de débito."
  );
}

export type RemoteVoiding = { id: string; receiptId: string; kind: string; reason: string; status: "ACCEPTED" | "PENDING" | "REJECTED" | "ERROR"; ticket?: string; message?: string };

async function voidingOrThrow(response: Response) {
  const body = await response.json().catch(() => ({})) as { voiding?: RemoteVoiding; message?: string };
  if (body.voiding) return body.voiding;
  throw new Error(body.message ?? "No pudimos dar de baja el comprobante.");
}

/** Comunicación de baja (facturas) o resumen de baja (boletas). SUNAT confirma en minutos. */
export async function requestBaja(receiptId: string, reason: string) {
  return voidingOrThrow(await authorizedFetch(`/v1/receipts/${encodeURIComponent(receiptId)}/baja`, { method: "POST", body: JSON.stringify({ reason }) }));
}

export async function refreshVoiding(voidingId: string) {
  return voidingOrThrow(await authorizedFetch(`/v1/voidings/${encodeURIComponent(voidingId)}/refresh`, { method: "POST" }));
}

// ---------- Guías de remisión ----------

export type GuideParty = { documentType: "6" | "1" | "4" | "7"; documentNumber: string; name: string; address?: string };
export type GuideInput = {
  clientTransactionId: string;
  guideType: "REMITENTE" | "TRANSPORTISTA";
  relatedReceiptId?: string;
  data: {
    recipient: GuideParty;
    shipper?: GuideParty;
    reasonCode?: string;
    reasonDescription?: string;
    transportMode?: "01" | "02";
    transferDate: string;
    grossWeight: number;
    weightUnit: "KGM" | "TNE";
    packages?: number;
    origin: { ubigeo: string; address: string };
    destination: { ubigeo: string; address: string };
    carrier?: { documentNumber: string; name: string; mtcNumber?: string };
    vehiclePlate?: string;
    driver?: { documentType: "1" | "4" | "7"; documentNumber: string; names: string; surnames: string; license: string };
    notes?: string;
    items: Array<{ code?: string; description: string; quantity: number; unit: string }>;
  };
};
export type RemoteGuide = {
  id: string;
  guideType: "REMITENTE" | "TRANSPORTISTA";
  number: string;
  issueDate: string;
  transferDate: string;
  status: "ACCEPTED" | "PENDING" | "REJECTED" | "ERROR";
  message?: string;
  practice?: boolean;
  data: GuideInput["data"];
};

async function guideOrThrow(response: Response) {
  const body = await response.json().catch(() => ({})) as Partial<RemoteGuide> & { message?: string };
  if (body.id && body.status) return body as RemoteGuide;
  throw new Error(body.message ?? "No pudimos procesar la guía de remisión.");
}

export async function createGuide(input: GuideInput) {
  return guideOrThrow(await authorizedFetch("/v1/despatch-guides", { method: "POST", body: JSON.stringify(input) }));
}

export async function listGuides() {
  return json<RemoteGuide[]>(await authorizedFetch("/v1/despatch-guides"));
}

export async function getGuide(id: string) {
  return json<RemoteGuide>(await authorizedFetch(`/v1/despatch-guides/${encodeURIComponent(id)}`));
}

export async function refreshGuide(id: string) {
  return guideOrThrow(await authorizedFetch(`/v1/despatch-guides/${encodeURIComponent(id)}/refresh`, { method: "POST" }));
}

export async function shareGuide(id: string) {
  return json<{ pdfUrl: string; number: string }>(await authorizedFetch(`/v1/despatch-guides/${encodeURIComponent(id)}/share`, { method: "POST" }));
}

export function newTransactionId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
