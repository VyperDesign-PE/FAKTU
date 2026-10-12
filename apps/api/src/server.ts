import Fastify from "fastify";
import type { FastifyReply, FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import { z } from "zod";
import { sql } from "./db/client.js";
import { runMigrations } from "./db/migrations.js";
import { credentialsSchema } from "./modules/auth/schemas.js";
import { createUser, findUserByEmail } from "./modules/auth/userRepository.js";
import { hashPassword, verifyPassword } from "./modules/auth/password.js";
import { BillingService } from "./modules/billing/BillingService.js";
import { lookupCustomerDocument } from "./modules/customerLookup/customerLookupService.js";
import { CustomerDocumentLookupError } from "./modules/customerLookup/types.js";
import { lookupRucFromSources } from "./modules/customerLookup/rucLookupService.js";
import { getSunatRucRegistryStatus } from "./modules/sunatRuc/sunatRucRegistryRepository.js";
import { getCustomerById, searchCustomers, upsertCustomer } from "./modules/customers/customerRepository.js";
import { getMonthlyLookupSummary } from "./modules/customers/documentLookupUsageRepository.js";
import { listProducts, upsertProduct } from "./modules/products/productRepository.js";
import {
  applyBillingResult,
  buildBillingCommand,
  getReceiptById,
  getReceiptByTransaction,
  isFinalStatus,
  listReceipts,
  prepareReceipt,
  receiptToApi,
  type ReceiptRecord
} from "./modules/receipts/receiptRepository.js";
import { issueOrReconcileReceipt, processPendingReceipts } from "./modules/receipts/receiptIssuer.js";
import { priceItems, totalsMatch } from "./modules/receipts/pricing.js";
import { assertDocumentRules, DocumentRuleError } from "./modules/receipts/documentRules.js";
import { getMembershipRole } from "./modules/tenants/membershipRepository.js";
import { hasBillingCredential } from "./modules/billing/secretResolver.js";
import { getBusiness, updateBusiness } from "./modules/tenants/tenantRepository.js";
import {
  getBillingConnectionState,
  getTenantBillingConfig,
  recordBillingConnectionTest,
  updateTenantBillingConfig,
  validProviders
} from "./modules/billing/tenantBillingConfigRepository.js";
import type { BillingEnvironment, BillingProviderCode } from "./modules/billing/contracts.js";
import { createReceiptSharePackage } from "./modules/sharing/receiptSharingService.js";
import { verifyReceiptLinkToken } from "./modules/sharing/publicReceiptLinks.js";
import { renderReceiptPdf } from "./modules/sharing/receiptPdf.js";
import { DeliveryService } from "./modules/delivery/DeliveryService.js";
import { enqueueDelivery, listDeliveries, releaseWaitingDeliveries } from "./modules/delivery/deliveryRepository.js";

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

const jwtSecret = process.env.JWT_SECRET ?? (process.env.NODE_ENV === "production" ? "" : "dev-only-change-me-before-production");
if (!jwtSecret) throw new Error("JWT_SECRET es obligatorio en producción");
await app.register(jwt, { secret: jwtSecret });

if ((process.env.DB_AUTO_MIGRATE ?? "true").toLowerCase() === "true") await runMigrations();
const billingService = new BillingService();
const deliveryService = new DeliveryService();

type SessionClaims = { sub: string; email: string; tenantId: string };

async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch {
    return reply.code(401).send({ message: "Tu sesión venció. Ingresa nuevamente." });
  }
}

function claims(request: FastifyRequest): SessionClaims {
  return request.user as SessionClaims;
}

function issueSession(user: { id: string; email: string; tenantId: string }) {
  const accessToken = app.jwt.sign({ sub: user.id, email: user.email, tenantId: user.tenantId }, { expiresIn: "7d" });
  return { accessToken, user };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char] ?? char));
}

app.get("/health", async () => ({ ok: true }));

app.get("/v1/system-status", { preHandler: requireAuth }, async (request) => {
  const provider = await billingService.health(claims(request).tenantId);
  const ok = provider.status === "UP";
  return {
    status: ok ? "OK" : "ATTENTION",
    provider: provider.providerCode,
    message: ok ? "Todo funciona correctamente" : "Estamos revisando la conexión con el servicio de facturación"
  };
});

app.post("/v1/auth/register", async (request, reply) => {
  const parsed = credentialsSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ message: "Revisa el correo y la contraseña." });
  const { email, password } = parsed.data;
  if (await findUserByEmail(email)) return reply.code(409).send({ message: "Ya existe una cuenta con ese correo." });
  const user = await createUser(email, await hashPassword(password));
  if (!user) return reply.code(409).send({ message: "Ya existe una cuenta con ese correo." });
  return reply.code(201).send(issueSession({ id: user.id, email: user.email, tenantId: user.tenantId }));
});

app.post("/v1/auth/login", async (request, reply) => {
  const parsed = credentialsSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ message: "Revisa el correo y la contraseña." });
  const user = await findUserByEmail(parsed.data.email);
  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    return reply.code(401).send({ message: "Correo o contraseña incorrectos." });
  }
  return issueSession({ id: user.id, email: user.email, tenantId: user.tenantId });
});

app.get("/v1/auth/me", { preHandler: requireAuth }, async (request) => {
  const user = claims(request);
  return { id: user.sub, email: user.email, tenantId: user.tenantId };
});

// OTP de desarrollo: el código fijo 123456 solo existe fuera de producción.
// En producción el endpoint queda deshabilitado hasta integrar un proveedor SMS
// real; nunca se aceptan códigos sin verificar.
const otpDevMode = process.env.NODE_ENV !== "production";

app.post("/v1/auth/otp/request", { preHandler: requireAuth }, async (request, reply) => {
  const parsed = z.object({ phone: z.string().min(9) }).safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ message: "Número de celular inválido" });
  if (!otpDevMode) return reply.code(503).send({ message: "La verificación por SMS todavía no está disponible." });
  return { ok: true, devCode: "123456" };
});

app.post("/v1/auth/otp/verify", { preHandler: requireAuth }, async (request, reply) => {
  const parsed = z.object({ phone: z.string().min(9), code: z.string().length(6) }).safeParse(request.body);
  if (!otpDevMode) return reply.code(503).send({ message: "La verificación por SMS todavía no está disponible." });
  if (!parsed.success || parsed.data.code !== "123456") {
    return reply.code(400).send({ message: "Código incorrecto" });
  }
  return { ok: true };
});

app.get("/v1/subscription", { preHandler: requireAuth }, async (request) => {
  const tenantId = claims(request).tenantId;
  const rows = await sql`
    select plan_code, status, trial_ends_at, current_period_end
    from subscriptions where tenant_id = ${tenantId} limit 1
  `;
  return rows[0] ?? { plan_code: "MVP", status: "TRIALING" };
});

app.get("/v1/business", { preHandler: requireAuth }, async (request, reply) => {
  const business = await getBusiness(claims(request).tenantId);
  if (!business) return reply.code(404).send({ message: "Negocio no encontrado" });
  return business;
});

app.patch("/v1/business", { preHandler: requireAuth }, async (request, reply) => {
  const parsed = z.object({
    ruc: z.string().regex(/^\d{11}$/).optional(),
    businessName: z.string().min(2).max(200).optional(),
    tradeName: z.string().max(200).optional(),
    address: z.string().max(300).optional(),
    ubigeo: z.string().regex(/^\d{6}$/).optional(),
    department: z.string().max(100).optional(),
    province: z.string().max(100).optional(),
    district: z.string().max(100).optional(),
    phone: z.string().max(30).optional(),
    email: z.string().email().optional(),
    taxpayerStatus: z.string().max(50).optional(),
    onboardingComplete: z.boolean().optional()
  }).safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ message: "Revisa los datos del negocio." });
  return updateBusiness(claims(request).tenantId, parsed.data);
});

app.get("/v1/taxpayers/:ruc", { preHandler: requireAuth }, async (request, reply) => {
  const parsed = z.object({ ruc: z.string().regex(/^\d{11}$/) }).safeParse(request.params);
  if (!parsed.success) return reply.code(400).send({ message: "RUC inválido" });
  try {
    const result = await lookupRucFromSources(parsed.data.ruc);
    return {
      ruc: result.numero,
      businessName: result.nombreCompleto,
      tradeName: undefined,
      status: result.estado ?? "",
      address: result.direccion ?? "",
      source: result.source,
      sourceUpdatedAt: result.sourceUpdatedAt,
      simulated: result.source === "MOCK"
    };
  } catch (error) {
    if (error instanceof CustomerDocumentLookupError) return reply.code(error.statusCode).send({ message: error.message, code: error.code });
    throw error;
  }
});

app.post("/v1/customers/lookup", { preHandler: requireAuth }, async (request, reply) => {
  const parsed = z.object({ tipoDoc: z.enum(["DNI", "RUC"]), numero: z.string() }).safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ code: "INVALID_DOCUMENT", message: "Indica un tipo de documento y número válidos.", retryable: false });
  reply.header("Cache-Control", "no-store");
  try {
    return await lookupCustomerDocument(claims(request).tenantId, parsed.data.tipoDoc, parsed.data.numero);
  } catch (error) {
    if (error instanceof CustomerDocumentLookupError) {
      return reply.code(error.statusCode).send({ code: error.code, message: error.message, retryable: error.retryable });
    }
    request.log.error({ error }, "customer document lookup failed");
    return reply.code(500).send({ code: "UPSTREAM_ERROR", message: "No pudimos consultar el documento. Puedes completar el nombre manualmente.", retryable: true });
  }
});

app.get("/v1/customers", { preHandler: requireAuth }, async (request) => {
  const query = z.object({ q: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).optional() }).parse(request.query);
  return searchCustomers(claims(request).tenantId, query.q ?? "", query.limit ?? 50);
});

app.get("/v1/customers/:id", { preHandler: requireAuth }, async (request, reply) => {
  const parsed = z.object({ id: z.string().uuid() }).safeParse(request.params);
  if (!parsed.success) return reply.code(400).send({ message: "Cliente inválido" });
  const customer = await getCustomerById(claims(request).tenantId, parsed.data.id);
  if (!customer) return reply.code(404).send({ message: "Cliente no encontrado" });
  return customer;
});

app.post("/v1/customers", { preHandler: requireAuth }, async (request, reply) => {
  const parsed = z.object({
    documentType: z.enum(["DNI", "RUC"]),
    documentNumber: z.string(),
    fullName: z.string().min(2),
    address: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().email().optional()
  }).safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ message: "Revisa los datos del cliente." });
  return upsertCustomer({ tenantId: claims(request).tenantId, ...parsed.data, dataSource: "MANUAL" });
});

app.get("/v1/customer-lookups/summary", { preHandler: requireAuth }, async (request) => getMonthlyLookupSummary(claims(request).tenantId));

app.get("/v1/system/ruc-registry/status", { preHandler: requireAuth }, async () => getSunatRucRegistryStatus());

app.get("/v1/products", { preHandler: requireAuth }, async (request) => listProducts(claims(request).tenantId));

app.put("/v1/products/:clientProductId", { preHandler: requireAuth }, async (request, reply) => {
  const params = z.object({ clientProductId: z.string().min(1).max(120) }).safeParse(request.params);
  const body = z.object({ name: z.string().min(1), unitPrice: z.number().nonnegative(), unitCode: z.string().optional(), favorite: z.boolean().optional(), sku: z.string().optional() }).safeParse(request.body);
  if (!params.success || !body.success) return reply.code(400).send({ message: "Revisa los datos del producto." });
  return upsertProduct({ tenantId: claims(request).tenantId, clientProductId: params.data.clientProductId, ...body.data });
});

const receiptSchema = z.object({
  clientTransactionId: z.string().min(10),
  temporaryNumber: z.string().min(1),
  documentType: z.enum(["BOLETA", "FACTURA"]),
  total: z.number().positive(),
  customer: z.object({
    documentType: z.enum(["DNI", "RUC"]).optional(),
    documentNumber: z.string().optional(),
    name: z.string().optional(),
    address: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().email().optional()
  }).optional(),
  items: z.array(z.object({ id: z.string(), name: z.string().min(1), quantity: z.number().positive(), unitPrice: z.number().nonnegative(), unit: z.string().optional() })).min(1)
});

function sendReceipt(reply: FastifyReply, receipt: ReceiptRecord, failed = false) {
  const payload = receiptToApi(receipt);
  if (receipt.status === "ACEPTADO") return reply.send(payload);
  if (receipt.status === "RECHAZADO") return reply.code(422).send(payload);
  if (failed || receipt.status === "ERROR") return reply.code(503).send(payload);
  return reply.code(202).send(payload);
}

app.post("/v1/receipts", { preHandler: requireAuth }, async (request, reply) => {
  const parsed = receiptSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ code: "INVALID_RECEIPT", message: "Datos de venta incompletos", retryable: false, details: parsed.error.flatten() });
  const tenantId = claims(request).tenantId;

  // Una venta ya registrada se responde con su estado guardado (idempotencia).
  const existing = await getReceiptByTransaction(tenantId, parsed.data.clientTransactionId);
  if (!existing) {
    // Validaciones ANTES de reservar correlativo: el servidor recalcula montos
    // y aplica las reglas tributarias; nunca confía en el total del celular.
    let serverTotal: number;
    try {
      serverTotal = priceItems(parsed.data.items).total;
    } catch (error) {
      return reply.code(422).send({ code: "INVALID_ITEMS", message: error instanceof Error ? error.message : "Ítems inválidos", retryable: false });
    }
    if (!totalsMatch(parsed.data.total, serverTotal)) {
      return reply.code(422).send({
        code: "TOTAL_MISMATCH",
        message: `El total de la venta (S/ ${parsed.data.total.toFixed(2)}) no coincide con los productos (S/ ${serverTotal.toFixed(2)}).`,
        expectedTotal: serverTotal,
        retryable: false
      });
    }
    try {
      assertDocumentRules({ documentType: parsed.data.documentType, total: serverTotal, customer: parsed.data.customer });
    } catch (error) {
      if (error instanceof DocumentRuleError) return reply.code(422).send({ code: error.code, message: error.message, retryable: false });
      throw error;
    }
  }

  const prepared = existing ? { receipt: existing } : await prepareReceipt({ tenantId, ...parsed.data });
  if (isFinalStatus(prepared.receipt.status)) {
    return sendReceipt(reply, (await getReceiptById(tenantId, prepared.receipt.id)) ?? prepared.receipt);
  }

  const outcome = await issueOrReconcileReceipt(billingService, tenantId, prepared.receipt.id);
  if (outcome.failed) request.log.warn({ receiptId: outcome.receipt.id, message: outcome.receipt.providerMessage }, "receipt issue failed");
  return sendReceipt(reply, outcome.receipt, outcome.failed);
});

app.get("/v1/receipts", { preHandler: requireAuth }, async (request) => {
  const query = z.object({ limit: z.coerce.number().int().min(1).max(200).optional() }).parse(request.query);
  return (await listReceipts(claims(request).tenantId, query.limit ?? 100)).map(receiptToApi);
});

app.get("/v1/receipts/by-transaction/:clientTransactionId", { preHandler: requireAuth }, async (request, reply) => {
  const parsed = z.object({ clientTransactionId: z.string().min(10) }).safeParse(request.params);
  if (!parsed.success) return reply.code(400).send({ message: "Transacción inválida" });
  const receipt = await getReceiptByTransaction(claims(request).tenantId, parsed.data.clientTransactionId);
  if (!receipt) return reply.code(404).send({ message: "Comprobante no encontrado" });
  const full = await getReceiptById(claims(request).tenantId, receipt.id);
  return receiptToApi(full ?? receipt);
});

app.get("/v1/receipts/:id", { preHandler: requireAuth }, async (request, reply) => {
  const parsed = z.object({ id: z.string().uuid() }).safeParse(request.params);
  if (!parsed.success) return reply.code(400).send({ message: "Comprobante inválido" });
  const receipt = await getReceiptById(claims(request).tenantId, parsed.data.id);
  if (!receipt) return reply.code(404).send({ message: "Comprobante no encontrado" });
  return receiptToApi(receipt);
});

app.post("/v1/receipts/:id/reconcile", { preHandler: requireAuth }, async (request, reply) => {
  const parsed = z.object({ id: z.string().uuid() }).safeParse(request.params);
  if (!parsed.success) return reply.code(400).send({ message: "Comprobante inválido" });
  const tenantId = claims(request).tenantId;
  const receipt = await getReceiptById(tenantId, parsed.data.id);
  if (!receipt) return reply.code(404).send({ message: "Comprobante no encontrado" });
  if (isFinalStatus(receipt.status)) return sendReceipt(reply, receipt);
  const result = await billingService.reconcileDocument(await buildBillingCommand(receipt));
  const stored = await applyBillingResult(tenantId, receipt.id, result);
  if (stored.status === "ACEPTADO") await releaseWaitingDeliveries(tenantId, stored.id);
  return sendReceipt(reply, stored);
});

async function shareByReceipt(receiptId: string, tenantId: string, reply: FastifyReply) {
  const [receipt, business] = await Promise.all([getReceiptById(tenantId, receiptId), getBusiness(tenantId)]);
  if (!receipt || !business) return reply.code(404).send({ message: "Comprobante no encontrado" });
  try {
    return createReceiptSharePackage(receipt, business);
  } catch (error) {
    return reply.code(409).send({ message: error instanceof Error ? error.message : "El comprobante todavía no puede compartirse." });
  }
}

app.post("/v1/receipts/by-transaction/:clientTransactionId/share", { preHandler: requireAuth }, async (request, reply) => {
  const parsed = z.object({ clientTransactionId: z.string().min(10) }).safeParse(request.params);
  if (!parsed.success) return reply.code(400).send({ message: "Transacción inválida" });
  const tenantId = claims(request).tenantId;
  const receipt = await getReceiptByTransaction(tenantId, parsed.data.clientTransactionId);
  if (!receipt) return reply.code(404).send({ message: "Comprobante no encontrado" });
  return shareByReceipt(receipt.id, tenantId, reply);
});

app.post("/v1/receipts/:id/share", { preHandler: requireAuth }, async (request, reply) => {
  const parsed = z.object({ id: z.string().uuid() }).safeParse(request.params);
  if (!parsed.success) return reply.code(400).send({ message: "Comprobante inválido" });
  return shareByReceipt(parsed.data.id, claims(request).tenantId, reply);
});

app.get("/r", async (request, reply) => {
  const parsed = z.object({ t: z.string().min(20) }).safeParse(request.query);
  if (!parsed.success) return reply.code(400).type("text/plain").send("Enlace inválido");
  try {
    const token = verifyReceiptLinkToken(parsed.data.t, "VIEW");
    const [receipt, business] = await Promise.all([getReceiptById(token.tenantId, token.receiptId), getBusiness(token.tenantId)]);
    if (!receipt || !business) return reply.code(404).type("text/plain").send("Comprobante no encontrado");
    const name = business.tradeName ?? business.businessName ?? "Comprobante electrónico";
    const number = receipt.officialNumber ?? `${receipt.series}-${String(receipt.correlative).padStart(8, "0")}`;
    const items = (receipt.items ?? []).map((item) => `<tr><td>${escapeHtml(item.name)}</td><td>${item.quantity}</td><td>S/ ${(item.quantity * item.unitPrice).toFixed(2)}</td></tr>`).join("");
    return reply.type("text/html; charset=utf-8").send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(number)}</title><style>body{font-family:system-ui,sans-serif;background:#f6f4fb;margin:0;padding:24px;color:#241b3a}.card{max-width:720px;margin:auto;background:#fff;border-radius:18px;padding:24px;box-shadow:0 8px 30px #0001}h1{font-size:22px}table{width:100%;border-collapse:collapse}td{padding:10px 0;border-bottom:1px solid #eee}.total{font-size:22px;font-weight:800;text-align:right}.muted{color:#6f6880}</style></head><body><main class="card"><h1>${escapeHtml(name)}</h1><p class="muted">${escapeHtml(receipt.documentType)} ${escapeHtml(number)}</p><p>Cliente: ${escapeHtml(receipt.customer?.name ?? "Público general")}</p><table>${items}</table><p>Subtotal: S/ ${receipt.subtotal.toFixed(2)}<br>IGV: S/ ${receipt.igv.toFixed(2)}</p><p class="total">Total: S/ ${receipt.total.toFixed(2)}</p>${receipt.providerCode === "mock" ? '<p><strong>ENTORNO DE PRUEBA - SIN VALIDEZ TRIBUTARIA.</strong></p>' : ''}</main></body></html>`);
  } catch (error) {
    return reply.code(400).type("text/plain").send(error instanceof Error ? error.message : "Enlace inválido");
  }
});

app.get("/r/pdf", async (request, reply) => {
  const parsed = z.object({ t: z.string().min(20) }).safeParse(request.query);
  if (!parsed.success) return reply.code(400).send("Enlace inválido");
  try {
    const token = verifyReceiptLinkToken(parsed.data.t, "PDF");
    const [receipt, business] = await Promise.all([getReceiptById(token.tenantId, token.receiptId), getBusiness(token.tenantId)]);
    if (!receipt || !business) return reply.code(404).send("Comprobante no encontrado");
    const pdf = renderReceiptPdf(receipt, business);
    return reply.header("Content-Type", "application/pdf").header("Content-Disposition", `inline; filename="${receipt.officialNumber ?? "comprobante"}.pdf"`).send(pdf);
  } catch (error) {
    return reply.code(400).send(error instanceof Error ? error.message : "Enlace inválido");
  }
});

app.post("/v1/receipts/by-transaction/:clientTransactionId/deliveries", { preHandler: requireAuth }, async (request, reply) => {
  const params = z.object({ clientTransactionId: z.string().min(10) }).safeParse(request.params);
  const body = z.object({
    channel: z.enum(["WHATSAPP", "EMAIL", "SMS"]),
    destination: z.string().min(3).max(200)
  }).safeParse(request.body);
  if (!params.success || !body.success) return reply.code(400).send({ message: "Revisa el canal y destino de entrega." });
  const tenantId = claims(request).tenantId;
  const receipt = await getReceiptByTransaction(tenantId, params.data.clientTransactionId);
  if (!receipt) return reply.code(404).send({ message: "Comprobante no encontrado" });
  const idempotencyKey = `${receipt.clientTransactionId}:${body.data.channel}:${body.data.destination.trim().toLowerCase()}`;
  const delivery = await enqueueDelivery({
    tenantId,
    receiptId: receipt.id,
    channel: body.data.channel,
    destination: body.data.destination.trim(),
    idempotencyKey,
    waitForReceipt: receipt.status !== "ACEPTADO"
  });
  return reply.code(201).send(delivery);
});

app.get("/v1/deliveries", { preHandler: requireAuth }, async (request) => {
  const query = z.object({ limit: z.coerce.number().int().min(1).max(200).optional() }).parse(request.query);
  return listDeliveries(claims(request).tenantId, query.limit ?? 100);
});

app.post("/v1/deliveries/process-pending", { preHandler: requireAuth }, async (request) => {
  return deliveryService.processPending(claims(request).tenantId);
});

const providerCatalog = [
  { code: "mock", name: "Simulador", note: "Solo pruebas. No emite a SUNAT." },
  { code: "apisperu", name: "APIsPERU", note: "Adaptador nativo disponible para sandbox. Producción requiere credenciales y validación final." },
  { code: "nubefact", name: "NubeFact", note: "Adaptador nativo pendiente de homologación." },
  { code: "efact", name: "Efact", note: "Adaptador nativo pendiente de homologación." },
  { code: "senda", name: "Senda", note: "Adaptador nativo pendiente de homologación." }
] as const;

app.get("/v1/billing/providers", { preHandler: requireAuth }, async () => ({ providers: providerCatalog }));

async function billingSettingsView(tenantId: string) {
  const [config, state] = await Promise.all([getTenantBillingConfig(tenantId), getBillingConnectionState(tenantId)]);
  // La referencia del secreto es un dato interno de la plataforma: no se expone.
  const { credentialSecretRef: _secretRef, ...publicConfig } = config;
  return { ...publicConfig, ...state, credentialConfigured: hasBillingCredential(config) };
}

async function requireTenantAdmin(request: FastifyRequest, reply: FastifyReply) {
  const session = claims(request);
  const role = await getMembershipRole(session.tenantId, session.sub);
  if (role !== "OWNER" && role !== "ADMIN") {
    return reply.code(403).send({ message: "Solo el titular del negocio puede cambiar esta configuración." });
  }
}

app.get("/v1/billing/settings", { preHandler: requireAuth }, async (request) => billingSettingsView(claims(request).tenantId));

app.patch("/v1/billing/settings", { preHandler: [requireAuth, requireTenantAdmin] }, async (request, reply) => {
  // credentialSecretRef ya no se acepta desde la app: lo asigna operaciones.
  const parsed = z.object({
    providerCode: z.string(),
    environment: z.enum(["sandbox", "production"]),
    providerAccountRef: z.string().max(200).optional()
  }).strict().safeParse(request.body);
  if (!parsed.success || !validProviders.has(parsed.data.providerCode as BillingProviderCode)) return reply.code(400).send({ message: "Configuración de proveedor inválida" });
  if (parsed.data.environment === "production" && (process.env.BILLING_PRODUCTION_ENABLED ?? "false").toLowerCase() !== "true") {
    return reply.code(409).send({ message: "La emisión en producción todavía no está habilitada en FAKTU." });
  }
  const tenantId = claims(request).tenantId;
  const current = await getTenantBillingConfig(tenantId);
  await updateTenantBillingConfig({
    tenantId,
    providerCode: parsed.data.providerCode as BillingProviderCode,
    environment: parsed.data.environment as BillingEnvironment,
    providerAccountRef: parsed.data.providerAccountRef,
    credentialSecretRef: current.credentialSecretRef
  });
  return billingSettingsView(tenantId);
});

app.post("/v1/billing/test-connection", { preHandler: [requireAuth, requireTenantAdmin] }, async (request, reply) => {
  const tenantId = claims(request).tenantId;
  try {
    const result = await billingService.health(tenantId);
    const ok = result.status === "UP";
    const message = ok ? "Conexión verificada correctamente." : result.message ?? (result.status === "DEGRADED" ? "La conexión respondió, pero necesita revisión." : "No pudimos conectar con el proveedor.");
    await recordBillingConnectionTest(tenantId, ok, message);
    return reply.code(ok ? 200 : 503).send({ ok, status: result.status, provider: result.providerCode, message });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No pudimos verificar la conexión.";
    await recordBillingConnectionTest(tenantId, false, message).catch(() => undefined);
    return reply.code(503).send({ ok: false, message });
  }
});

app.post("/v1/pse/authorization-session", { preHandler: requireAuth }, async () => ({
  mode: "MOCK",
  authorizationUrl: "https://example.invalid/pse/authorize",
  message: "En producción este endpoint iniciará el flujo seguro del proveedor seleccionado sin almacenar la Clave SOL."
}));

const port = Number(process.env.API_PORT ?? 4000);
await app.listen({ port, host: "0.0.0.0" });

// Reintentos/conciliación en el servidor para comprobantes que quedaron
// pendientes (respuesta perdida, proveedor caído), sin depender del celular.
const workerIntervalMs = Number(process.env.RECEIPT_WORKER_INTERVAL_MS ?? 60_000);
if ((process.env.RECEIPT_WORKER_ENABLED ?? "true").toLowerCase() === "true" && workerIntervalMs > 0) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const processed = await processPendingReceipts(billingService);
      if (processed.length) app.log.info({ processed }, "pending receipts processed");
    } catch (error) {
      app.log.error({ error }, "pending receipts worker failed");
    } finally {
      running = false;
    }
  }, workerIntervalMs);
  timer.unref();
}
