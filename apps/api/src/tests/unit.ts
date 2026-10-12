import assert from "node:assert/strict";
import { priceItems, totalsMatch } from "../modules/receipts/pricing.js";
import { assertDocumentRules, DocumentRuleError } from "../modules/receipts/documentRules.js";
import { isAllowedSecretRef, resolveBillingCredential, tenantSecretEnvName } from "../modules/billing/secretResolver.js";
import { assertIssuingAllowed, BillingConfigError } from "../modules/billing/BillingService.js";
import { isAlreadyRegisteredResponse, mapCommandToApiPeru } from "../modules/billing/providers/ApiPeruBillingProvider.js";
import type { BillingIssuer, IssueDocumentCommand, TenantBillingConfig } from "../modules/billing/contracts.js";
import { isPracticeSeries, PRACTICE_SERIES } from "../modules/billing/practiceMode.js";

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

function expectRule(code: string, fn: () => void) {
  assert.throws(fn, (error: unknown) => error instanceof DocumentRuleError && error.code === code);
}

// ---------- Montos ----------
test("los montos de cabecera son la suma exacta de las líneas", () => {
  const priced = priceItems([
    { quantity: 1, unitPrice: 1 },
    { quantity: 1, unitPrice: 1 },
    { quantity: 1, unitPrice: 1 }
  ]);
  assert.equal(priced.total, 3);
  const sumSubtotal = priced.lines.reduce((sum, line) => sum + Math.round(line.lineSubtotal * 100), 0) / 100;
  const sumIgv = priced.lines.reduce((sum, line) => sum + Math.round(line.lineIgv * 100), 0) / 100;
  assert.equal(priced.subtotal, sumSubtotal);
  assert.equal(priced.igv, sumIgv);
  assert.equal(Math.round((priced.subtotal + priced.igv) * 100), 300);
});

test("118 con IGV se separa en 100 + 18", () => {
  const priced = priceItems([{ quantity: 2, unitPrice: 59 }]);
  assert.deepEqual([priced.subtotal, priced.igv, priced.total], [100, 18, 118]);
  assert.equal(priced.lines[0].unitValue, 50);
});

test("cantidades fraccionarias redondean por línea", () => {
  const priced = priceItems([{ quantity: 0.333, unitPrice: 3 }, { quantity: 1.5, unitPrice: 2.99 }]);
  assert.equal(priced.total, 1 + 4.49);
});

test("precio o cantidad inválidos se rechazan", () => {
  assert.throws(() => priceItems([{ quantity: 0, unitPrice: 1 }]));
  assert.throws(() => priceItems([{ quantity: 1, unitPrice: -1 }]));
  assert.throws(() => priceItems([{ quantity: Number.NaN, unitPrice: 1 }]));
});

test("el total del celular se compara con tolerancia de 1 céntimo", () => {
  assert.ok(totalsMatch(10.0, 10.01));
  assert.ok(!totalsMatch(1, 100));
});

// ---------- Reglas tributarias ----------
test("factura exige cliente con RUC y razón social", () => {
  expectRule("FACTURA_REQUIRES_RUC", () => assertDocumentRules({ documentType: "FACTURA", total: 10 }));
  expectRule("FACTURA_REQUIRES_RUC", () => assertDocumentRules({ documentType: "FACTURA", total: 10, customer: { documentType: "DNI", documentNumber: "12345678", name: "ANA" } }));
  expectRule("FACTURA_REQUIRES_NAME", () => assertDocumentRules({ documentType: "FACTURA", total: 10, customer: { documentType: "RUC", documentNumber: "20142485878" } }));
  assertDocumentRules({ documentType: "FACTURA", total: 10, customer: { documentType: "RUC", documentNumber: "20142485878", name: "CENCA" } });
});

test("boleta mayor a S/ 700 exige identificar al cliente", () => {
  assertDocumentRules({ documentType: "BOLETA", total: 700 });
  expectRule("BOLETA_REQUIRES_CUSTOMER", () => assertDocumentRules({ documentType: "BOLETA", total: 700.01 }));
  assertDocumentRules({ documentType: "BOLETA", total: 900, customer: { documentType: "DNI", documentNumber: "12345678", name: "ANA" } });
});

test("formatos de DNI y RUC", () => {
  expectRule("INVALID_DNI", () => assertDocumentRules({ documentType: "BOLETA", total: 5, customer: { documentType: "DNI", documentNumber: "1234" } }));
  expectRule("INVALID_RUC", () => assertDocumentRules({ documentType: "BOLETA", total: 5, customer: { documentType: "RUC", documentNumber: "99999999999" } }));
});

// ---------- Credenciales ----------
function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const tenantId = "3f2b8c1a-0000-4000-8000-000000000001";
const config = (patch: Partial<TenantBillingConfig> = {}): TenantBillingConfig => ({ tenantId, providerCode: "apisperu", environment: "sandbox", ...patch });

test("una referencia de secreto no puede apuntar a variables del sistema", () => {
  assert.ok(!isAllowedSecretRef("env:JWT_SECRET"));
  assert.ok(!isAllowedSecretRef("env:DATABASE_URL"));
  assert.ok(isAllowedSecretRef("env:BILLING_TOKEN_EMPRESA_1"));
  withEnv({ JWT_SECRET: "super-secret" }, () => {
    assert.throws(() => resolveBillingCredential(config({ credentialSecretRef: "env:JWT_SECRET" })), /soporte/);
  });
});

test("cada negocio usa su propio token", () => {
  withEnv({ [tenantSecretEnvName(tenantId)]: "token-propio", APISPERU_API_TOKEN: "token-compartido", BILLING_ALLOW_SHARED_SANDBOX_TOKEN: undefined }, () => {
    assert.equal(resolveBillingCredential(config()), "token-propio");
  });
});

test("el token compartido solo se usa en sandbox y con permiso explícito", () => {
  withEnv({ [tenantSecretEnvName(tenantId)]: undefined, APISPERU_API_TOKEN: "token-compartido", BILLING_ALLOW_SHARED_SANDBOX_TOKEN: undefined }, () => {
    assert.equal(resolveBillingCredential(config()), undefined);
  });
  withEnv({ [tenantSecretEnvName(tenantId)]: undefined, APISPERU_API_TOKEN: "token-compartido", BILLING_ALLOW_SHARED_SANDBOX_TOKEN: "true" }, () => {
    assert.equal(resolveBillingCredential(config()), "token-compartido");
    assert.equal(resolveBillingCredential(config({ environment: "production" })), undefined);
  });
});

test("producción: el modo práctica se puede desactivar y la emisión real exige habilitación", () => {
  withEnv({ NODE_ENV: "production", ALLOW_MOCK_BILLING: undefined, BILLING_PRODUCTION_ENABLED: undefined }, () => {
    assertIssuingAllowed(config({ providerCode: "mock" }));
    assert.throws(() => assertIssuingAllowed(config({ environment: "production" })), BillingConfigError);
  });
  withEnv({ NODE_ENV: "production", ALLOW_MOCK_BILLING: "false" }, () => {
    assert.throws(() => assertIssuingAllowed(config({ providerCode: "mock" })), BillingConfigError);
  });
  withEnv({ NODE_ENV: "production", BILLING_PRODUCTION_ENABLED: "true" }, () => {
    assertIssuingAllowed(config({ environment: "production" }));
  });
});

// ---------- Modo práctica ----------
test("las series de práctica empiezan con T y no chocan con las reales", () => {
  assert.ok(isPracticeSeries(PRACTICE_SERIES.BOLETA));
  assert.ok(isPracticeSeries(PRACTICE_SERIES.FACTURA));
  assert.ok(isPracticeSeries(PRACTICE_SERIES.NOTA_CREDITO));
  for (const real of ["B001", "F001", "BC01", "FC01", "BBB1", "FFF1"]) assert.ok(!isPracticeSeries(real));
});

// ---------- Adaptador APIsPERU ----------
const issuer: BillingIssuer = { ruc: "20142485878", legalName: "EMPRESA PRUEBA" };
const baseCommand: IssueDocumentCommand = {
  tenantId,
  clientTransactionId: "tx-unit-0001",
  documentType: "BOLETA",
  series: "B001",
  correlative: 7,
  currency: "PEN",
  issueDate: "2026-10-01T15:00:00.000Z",
  items: [1, 2, 3].map((n) => ({ sku: `P${n}`, description: `ITEM ${n}`, quantity: 1, unitPrice: 1 })),
  subtotal: 2.55,
  igv: 0.45,
  total: 3
};

test("APIsPERU: el detalle cuadra con la cabecera", () => {
  const mapped = mapCommandToApiPeru(baseCommand, issuer);
  const sumValorVenta = mapped.details.reduce((sum, line) => sum + Math.round(line.mtoValorVenta * 100), 0) / 100;
  const sumIgv = mapped.details.reduce((sum, line) => sum + Math.round(line.igv * 100), 0) / 100;
  assert.equal(mapped.mtoOperGravadas, sumValorVenta);
  assert.equal(mapped.mtoIGV, sumIgv);
  assert.equal(mapped.mtoImpVenta, 3);
});

test("APIsPERU: no envía si el total guardado no coincide con el detalle", () => {
  assert.throws(() => mapCommandToApiPeru({ ...baseCommand, total: 1 }, issuer), /no coincide/);
});

test("APIsPERU: 'registrado previamente' (1033) no es un rechazo", () => {
  assert.ok(isAlreadyRegisteredResponse({ sunatResponse: { success: false, error: { code: "1033", message: "El comprobante fue registrado previamente con otros datos" } } }));
  assert.ok(!isAlreadyRegisteredResponse({ sunatResponse: { success: false, error: { code: "2017", message: "El número de documento de identidad del receptor debe ser RUC" } } }));
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  ✗ ${name}\n    ${error instanceof Error ? error.message : String(error)}`);
  }
}
console.log(failed ? `UNIT TESTS: ${failed} FAILED` : `UNIT TESTS: ${tests.length} PASS`);
process.exit(failed ? 1 : 0);
