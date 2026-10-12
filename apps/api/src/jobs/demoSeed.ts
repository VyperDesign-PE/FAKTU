/**
 * Carga un negocio de demostración con ventas de los últimos 7 días, stock bajo
 * y fiados, para que el dashboard se vea "vivo" en una presentación.
 *
 *   npm run demo:seed                      (API en http://localhost:4000)
 *   DEMO_API_URL=http://localhost:4300 npm run demo:seed
 *
 * Usa la API pública y, solo para mover fechas hacia atrás, la misma base de
 * datos (DATABASE_URL). Es idempotente: si el usuario demo ya existe, no repite.
 * Todo queda en modo práctica (simulador): sin validez ante SUNAT.
 */
import { closeDatabase, sql } from "../db/client.js";

const API = (process.env.DEMO_API_URL ?? "http://localhost:4000").replace(/\/$/, "");
const EMAIL = process.env.DEMO_EMAIL ?? "demo@faktu.pe";
const PASSWORD = process.env.DEMO_PASSWORD ?? "Demo-Faktu-2026";

let token = "";
async function call<T = Record<string, unknown>>(path: string, method = "GET", body?: unknown, okStatuses = [200, 201, 202]): Promise<{ status: number; data: T }> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = (await response.json().catch(() => ({}))) as T;
  if (!okStatuses.includes(response.status) && !(response.status === 204)) throw new Error(`${method} ${path} -> ${response.status} ${JSON.stringify(data)}`);
  return { status: response.status, data };
}

const PRODUCTS = [
  { id: "arroz-costeno-1kg", name: "Arroz Costeño 1 kg", price: 4.5, stock: 120, min: 20 },
  { id: "azucar-rubia-1kg", name: "Azúcar rubia 1 kg", price: 4.2, stock: 90, min: 15 },
  { id: "aceite-primor-1l", name: "Aceite Primor 1 L", price: 11.9, stock: 40, min: 10 },
  { id: "leche-gloria-400", name: "Leche Gloria 400 g", price: 4.8, stock: 60, min: 12 },
  { id: "inca-kola-500", name: "Inca Kola 500 ml", price: 3, stock: 7, min: 12 },
  { id: "agua-cielo-625", name: "Agua San Luis 625 ml", price: 1.5, stock: 150, min: 24 },
  { id: "pan-frances", name: "Pan francés (unidad)", price: 0.4, stock: 10, min: 30 },
  { id: "huevos-x12", name: "Huevos x 12", price: 8.5, stock: 35, min: 8 },
  { id: "atun-florida", name: "Atún Florida", price: 5.5, stock: 70, min: 10 },
  { id: "papel-higienico-4", name: "Papel higiénico x 4", price: 6.9, stock: 45, min: 10 }
];

const DEBTORS = [
  { dni: "45871236", name: "ROSA MARIA PEREZ DIAZ", phone: "987654321", daysAgo: 12, items: [["arroz-costeno-1kg", 3], ["aceite-primor-1l", 1]] as Array<[string, number]>, paid: 10 },
  { dni: "70125489", name: "JUAN CARLOS QUISPE MAMANI", phone: "912345678", daysAgo: 4, items: [["inca-kola-500", 4], ["pan-frances", 10]] as Array<[string, number]>, paid: 0 },
  { dni: "41236587", name: "LUCIA FERNANDEZ ROJAS", phone: "956781234", daysAgo: 1, items: [["huevos-x12", 2], ["leche-gloria-400", 3]] as Array<[string, number]>, paid: 0 }
];

// Generador determinista: la demo se ve igual cada vez.
let seed = 20261013;
const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };

async function main() {
  const registered = await call("/v1/auth/register", "POST", { email: EMAIL, password: PASSWORD }, [200, 201, 409]);
  if (registered.status === 409) {
    console.log(`El usuario ${EMAIL} ya existe: la demo ya estaba cargada. Para reiniciarla usa una base nueva.`);
    return;
  }
  token = String((registered.data as { accessToken?: string }).accessToken);

  const ruc = `20${String(Date.now()).slice(-9)}`;
  await call("/v1/business", "PATCH", {
    ruc, businessName: "BODEGA DON PEPE S.A.C.", tradeName: "Bodega Don Pepe", address: "AV. LOS ÁLAMOS 123, SAN JUAN DE LURIGANCHO, LIMA", phone: "987000111", onboardingComplete: true
  });

  for (const p of PRODUCTS) {
    await call(`/v1/products/${p.id}`, "PUT", { name: p.name, unitPrice: p.price, favorite: true, minStock: p.min });
    await call(`/v1/products/${p.id}/stock`, "POST", { mode: "SET", quantity: 400, note: "Stock inicial" });
  }

  const price = new Map(PRODUCTS.map((p) => [p.id, p]));
  const lines = (items: Array<[string, number]>) => items.map(([id, quantity]) => ({ id, name: price.get(id)!.name, quantity, unitPrice: price.get(id)!.price }));
  const totalOf = (items: Array<[string, number]>) => Math.round(items.reduce((sum, [id, q]) => sum + q * price.get(id)!.price, 0) * 100) / 100;

  const methods = ["EFECTIVO", "EFECTIVO", "EFECTIVO", "YAPE", "YAPE", "PLIN", "TARJETA"];
  const dated: Array<{ tx: string; daysAgo: number }> = [];
  let n = 0;
  const sell = async (daysAgo: number, items: Array<[string, number]>, extra: Record<string, unknown>) => {
    n += 1;
    const tx = `demo-${Date.now()}-${n}`;
    const total = totalOf(items);
    await call("/v1/receipts", "POST", { clientTransactionId: tx, temporaryNumber: `VT-D${n}`, documentType: "BOLETA", total, items: lines(items), ...extra }, [200, 202]);
    dated.push({ tx, daysAgo });
  };

  // Ventas al público de los últimos 7 días (más movimiento hacia hoy).
  for (let daysAgo = 6; daysAgo >= 0; daysAgo -= 1) {
    const count = 4 + Math.floor(rand() * 4) + (daysAgo < 2 ? 2 : 0);
    for (let i = 0; i < count; i += 1) {
      const picks = 1 + Math.floor(rand() * 3);
      const items: Array<[string, number]> = [];
      for (let k = 0; k < picks; k += 1) {
        const product = PRODUCTS[Math.floor(rand() * PRODUCTS.length)];
        if (!items.some(([id]) => id === product.id)) items.push([product.id, 1 + Math.floor(rand() * 3)]);
      }
      await sell(daysAgo, items, { paymentMethod: methods[Math.floor(rand() * methods.length)] });
    }
  }

  // Una factura a una empresa.
  n += 1;
  const invoiceItems: Array<[string, number]> = [["arroz-costeno-1kg", 20], ["aceite-primor-1l", 6]];
  const invoiceTx = `demo-${Date.now()}-f`;
  await call("/v1/receipts", "POST", {
    clientTransactionId: invoiceTx, temporaryNumber: "VT-DF", documentType: "FACTURA", total: totalOf(invoiceItems), items: lines(invoiceItems), paymentMethod: "TRANSFERENCIA",
    customer: { documentType: "RUC", documentNumber: "20100070970", name: "SUPERMERCADOS PERUANOS SOCIEDAD ANONIMA", address: "CAL. MARTIR OLAYA NRO. 129 MIRAFLORES, LIMA" }
  }, [200, 202]);
  dated.push({ tx: invoiceTx, daysAgo: 2 });

  // Fiados con distinta antigüedad y un abono parcial.
  for (const debtor of DEBTORS) {
    await sell(debtor.daysAgo, debtor.items, { paymentMethod: "CREDITO", customer: { documentType: "DNI", documentNumber: debtor.dni, name: debtor.name, phone: debtor.phone } });
  }
  const open = await call<Array<{ receiptId: string; customerDocument?: string }>>("/v1/receivables");
  for (const debtor of DEBTORS.filter((d) => d.paid > 0)) {
    const receipt = (open.data as Array<{ receiptId: string; customerDocument?: string }>).find((r) => r.customerDocument === debtor.dni);
    if (receipt) await call(`/v1/receivables/${receipt.receiptId}/payments`, "POST", { amount: debtor.paid, method: "YAPE" });
  }

  // Una venta anulada para mostrar la nota de crédito.
  await sell(1, [["agua-cielo-625", 6]], { paymentMethod: "EFECTIVO" });
  const lastTx = dated[dated.length - 1].tx;
  const voidTarget = await call<{ id: string }>(`/v1/receipts/by-transaction/${lastTx}`);
  await call(`/v1/receipts/${voidTarget.data.id}/void`, "POST", { reason: "Error de digitación (demo)" }, [200, 202]);

  // Fechas: se mueven hacia atrás para que el gráfico de 7 días tenga forma.
  for (const { tx, daysAgo } of dated) {
    if (daysAgo > 0) await sql`update receipts set issue_date = issue_date - make_interval(days => ${daysAgo}) where client_transaction_id = ${tx}`;
  }

  // Stock final: unos productos quedan por debajo del mínimo (alerta en el dashboard).
  await call("/v1/products/inca-kola-500/stock", "POST", { mode: "SET", quantity: 4, note: "Conteo" });
  await call("/v1/products/pan-frances/stock", "POST", { mode: "SET", quantity: 12, note: "Conteo" });
  for (const p of PRODUCTS.filter((x) => !["inca-kola-500", "pan-frances"].includes(x.id))) {
    await call(`/v1/products/${p.id}/stock`, "POST", { mode: "SET", quantity: p.stock, note: "Conteo" });
  }

  console.log(`\nDemo lista en ${API}\n  Usuario:    ${EMAIL}\n  Contraseña: ${PASSWORD}\n  Negocio:    Bodega Don Pepe (modo práctica, sin validez SUNAT)\n`);
}

main()
  .catch((error) => { console.error("demo:seed falló:", error instanceof Error ? error.message : error); process.exitCode = 1; })
  .finally(() => closeDatabase().catch(() => undefined));
