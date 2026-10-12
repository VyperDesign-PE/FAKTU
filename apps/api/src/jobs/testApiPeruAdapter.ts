import { ApiPeruBillingProvider, mapCommandToApiPeru } from "../modules/billing/providers/ApiPeruBillingProvider.js";
import { amountInWordsPen } from "../modules/billing/amountInWords.js";
import type { BillingIssuer, IssueDocumentCommand } from "../modules/billing/contracts.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const issuer: BillingIssuer = {
  ruc: "20142485878",
  legalName: "INSTITUTO DE DESARROLLO URBANO CENCA",
  tradeName: "CENCA",
  address: {
    address: "AV. PRUEBA 123",
    ubigeo: "150101",
    department: "LIMA",
    province: "LIMA",
    district: "LIMA"
  }
};

const command: IssueDocumentCommand = {
  tenantId: "tenant-test",
  clientTransactionId: "tx-apisperu-test-0001",
  documentType: "BOLETA",
  series: "B001",
  correlative: 1,
  currency: "PEN",
  issueDate: "2026-08-28T13:00:00.000Z",
  customer: { documentType: "DNI", documentNumber: "12345678", name: "JUAN PEREZ" },
  items: [{ sku: "P001", description: "PRODUCTO PRUEBA", quantity: 2, unitPrice: 59, unitCode: "NIU" }],
  subtotal: 100,
  igv: 18,
  total: 118
};

const mapped = mapCommandToApiPeru(command, issuer);
assert(mapped.tipoDoc === "03", "Debe mapear boleta a tipoDoc 03");
assert(mapped.details[0]?.mtoValorUnitario === 50, "Debe separar correctamente el IGV del precio unitario");
assert(amountInWordsPen(118) === "SON CIENTO DIECIOCHO CON 00/100 SOLES", "Leyenda de monto incorrecta");

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url.includes("/invoice/send")) {
    const sent = JSON.parse(String(init?.body ?? "{}")) as { company?: { ruc?: string } };
    assert(sent.company?.ruc === issuer.ruc, "RUC emisor no mapeado");
    return new Response(JSON.stringify({
      xml: "BASE64XML",
      hash: "HASH123",
      sunatResponse: {
        success: true,
        cdrZip: "BASE64CDR",
        cdrResponse: { accepted: true, id: "B001-1", code: "0", description: "Aceptado", notes: [] }
      }
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.includes("/invoice/status")) {
    return new Response(JSON.stringify({
      success: true,
      cdrZip: "BASE64CDR",
      cdrResponse: { accepted: true, id: "B001-1", code: "0", description: "Aceptado", notes: [] }
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  throw new Error(`URL inesperada: ${url}`);
};

try {
  const provider = new ApiPeruBillingProvider({ token: "secret-test", issuer, baseUrl: "https://sandbox.example/api/v1/" });
  assert(await provider.health() === "UP", "Health check fallido");
  const issued = await provider.issueDocument(command);
  assert(issued.status === "ACCEPTED", "Emision simulada no aceptada");
  assert(issued.artifacts?.hash === "HASH123", "No se preservo el hash");
  const reconciled = await provider.getDocumentStatus(command);
  assert(reconciled.status === "ACCEPTED", "Conciliacion simulada fallida");

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/invoice/send")) throw new TypeError("simulated connection reset after POST");
    if (url.includes("/invoice/status")) {
      return new Response(JSON.stringify({
        success: true,
        cdrZip: "BASE64CDR",
        cdrResponse: { accepted: true, id: "B001-1", code: "0", description: "Aceptado", notes: [] }
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`URL inesperada: ${url}`);
  };
  const uncertain = await provider.issueDocument(command);
  assert(uncertain.status === "PENDING", "Una respuesta perdida no debe marcarse como rechazo");
  const recovered = await provider.getDocumentStatus(command);
  assert(recovered.status === "ACCEPTED", "Debe poder recuperar un POST de resultado incierto por conciliacion");

  let invoiceValidationWorked = false;
  try {
    mapCommandToApiPeru({ ...command, documentType: "FACTURA" }, issuer);
  } catch {
    invoiceValidationWorked = true;
  }
  assert(invoiceValidationWorked, "Factura sin RUC debe ser rechazada antes de llamar al proveedor");

  console.log("APISPERU ADAPTER TEST: PASS");
} finally {
  globalThis.fetch = originalFetch;
}
