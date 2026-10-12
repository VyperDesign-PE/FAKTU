import { randomUUID } from "node:crypto";
import { ApiPeruBillingProvider } from "../modules/billing/providers/ApiPeruBillingProvider.js";
import type { BillingIssuer, IssueDocumentCommand } from "../modules/billing/contracts.js";

function env(name: string, required = true) {
  const value = process.env[name]?.trim();
  if (required && !value) throw new Error(`Falta ${name}`);
  return value;
}

const token = env("APISPERU_API_TOKEN")!;
const ruc = env("APISPERU_SANDBOX_RUC")!;
const legalName = env("APISPERU_SANDBOX_LEGAL_NAME")!;
const issuer: BillingIssuer = {
  ruc,
  legalName,
  tradeName: env("APISPERU_SANDBOX_TRADE_NAME", false),
  address: {
    address: env("APISPERU_SANDBOX_ADDRESS", false),
    ubigeo: env("APISPERU_SANDBOX_UBIGEO", false),
    department: env("APISPERU_SANDBOX_DEPARTMENT", false),
    province: env("APISPERU_SANDBOX_PROVINCE", false),
    district: env("APISPERU_SANDBOX_DISTRICT", false)
  }
};

const provider = new ApiPeruBillingProvider({
  token,
  issuer,
  baseUrl: process.env.APISPERU_API_BASE_URL || "https://facturacion.apisperu.com/api/v1/"
});

console.log("1/2 Verificando conectividad no destructiva...");
const health = await provider.health();
console.log(`APIsPERU health: ${health}`);
if (health !== "UP") throw new Error("No se pudo validar la conectividad/credencial con APIsPERU");

if (process.env.APISPERU_SANDBOX_CONFIRM !== "YES") {
  console.log("CONEXION SANDBOX: OK");
  console.log("No se emitio ningun comprobante. Para emitir en beta establece APISPERU_SANDBOX_CONFIRM=YES.");
  process.exit(0);
}

const now = new Date();
const correlative = Number(process.env.APISPERU_SANDBOX_CORRELATIVE ?? Math.floor(Date.now() / 1000) % 9_000_000 + 1);
const command: IssueDocumentCommand = {
  tenantId: "sandbox-local",
  clientTransactionId: randomUUID(),
  documentType: "BOLETA",
  series: process.env.APISPERU_SANDBOX_SERIES || "B001",
  correlative,
  currency: "PEN",
  issueDate: now.toISOString(),
  customer: { name: "CLIENTE DE PRUEBA" },
  items: [{ sku: "TEST001", description: "PRODUCTO DE PRUEBA SANDBOX", quantity: 1, unitPrice: 1.18, unitCode: "NIU" }],
  subtotal: 1,
  igv: 0.18,
  total: 1.18
};

console.log("2/2 Enviando una boleta al ambiente beta configurado en APIsPERU...");
const result = await provider.issueDocument(command);
console.log(JSON.stringify(result, null, 2));
if (result.status === "PENDING") {
  console.log("Respuesta incierta/pendiente. Conciliando por serie y correlativo...");
  console.log(JSON.stringify(await provider.getDocumentStatus(command), null, 2));
}
