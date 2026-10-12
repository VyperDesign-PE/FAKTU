import type { AuthSession } from "../auth/types";
import type { BusinessProfile, PendingReceipt, Product } from "../domain/types";
import { getAccessToken } from "../storage/session";

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://10.0.2.2:4000";

async function json<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body as { message?: string }).message ?? "No pudimos completar la operación");
  return body as T;
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function authorizedFetch(path: string, init: RequestInit = {}) {
  const headers = {
    ...(init.body ? { "Content-Type": "application/json" } : {}),
    ...(await authHeaders()),
    ...(init.headers ?? {})
  };
  return fetch(`${API_URL}${path}`, { ...init, headers });
}

export async function loginWithEmail(email: string, password: string) {
  return json<AuthSession>(await fetch(`${API_URL}/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  }));
}

export async function registerWithEmail(email: string, password: string) {
  return json<AuthSession>(await fetch(`${API_URL}/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  }));
}

export async function requestOtp(phone: string) {
  return json<{ ok: true; devCode?: string }>(await authorizedFetch("/v1/auth/otp/request", {
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
  const expectedLength = tipoDoc === "DNI" ? 8 : 11;
  if (clean.length !== expectedLength) {
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
    phone?: string;
    taxpayerStatus?: string;
    onboardingComplete?: boolean;
  }>(await authorizedFetch("/v1/business"));
  return {
    ruc: business.ruc,
    businessName: business.businessName,
    tradeName: business.tradeName,
    address: business.address,
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
      phone: profile.phone,
      taxpayerStatus: profile.taxpayerStatus,
      onboardingComplete: profile.onboardingComplete
    })
  }));
}

export async function listRemoteProducts(): Promise<Product[]> {
  const rows = await json<Array<{ clientProductId: string; name: string; unitPrice: number; unitCode: string; favorite: boolean }>>(
    await authorizedFetch("/v1/products")
  );
  return rows.map((row) => ({ id: row.clientProductId, name: row.name, unitPrice: row.unitPrice, unit: row.unitCode, favorite: row.favorite }));
}

export async function upsertRemoteProduct(product: Product) {
  return json(await authorizedFetch(`/v1/products/${encodeURIComponent(product.id)}`, {
    method: "PUT",
    body: JSON.stringify({ name: product.name, unitPrice: product.unitPrice, unitCode: product.unit, favorite: product.favorite })
  }));
}

export type RemoteReceipt = {
  id: string;
  clientTransactionId: string;
  temporaryNumber: string;
  documentType: "BOLETA" | "FACTURA";
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
export type BillingProviderOption = { code: BillingProviderCode; name: string; note: string };
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
