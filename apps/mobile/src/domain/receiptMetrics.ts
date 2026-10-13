/**
 * Definiciones únicas de "venta vigente", "por revisar" y "pendiente" para la app.
 * Funciones puras (sin React Native) para usarlas igual en todas las pantallas y probarlas.
 *
 * Alcance: solo cuentan los registros que la app tiene cargados (cola local + historial
 * remoto limitado). Los totales globales del negocio salen del servidor (`getInsights`).
 */
import type { PendingReceipt } from "./types";

type RemoteLike = {
  clientTransactionId: string;
  documentType: "BOLETA" | "FACTURA" | "NOTA_CREDITO" | "NOTA_DEBITO";
  status: "ACCEPTED" | "PENDING" | "REJECTED" | "ERROR";
  voided?: boolean;
  total: number;
  issueDate: string;
};

/**
 * Venta vigente: boleta o factura aceptada y no anulada.
 * Las notas de crédito y débito son ajustes, no ventas; una anulada ya fue compensada por su nota.
 */
export function isEffectiveSale(receipt: RemoteLike) {
  return receipt.status === "ACCEPTED" && !receipt.voided && (receipt.documentType === "BOLETA" || receipt.documentType === "FACTURA");
}

export function isSameLocalDay(isoDate: string, now = new Date()) {
  const date = new Date(isoDate);
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
}

export function effectiveSales(history: RemoteLike[]) {
  return history.filter(isEffectiveSale);
}

export function todaySales(history: RemoteLike[], now = new Date()) {
  const sales = effectiveSales(history).filter((receipt) => isSameLocalDay(receipt.issueDate, now));
  const cents = sales.reduce((sum, receipt) => sum + Math.round(receipt.total * 100), 0);
  return { count: sales.length, total: cents / 100 };
}

/** Comprobantes que requieren atención, sin contar dos veces el mismo `clientTransactionId` (local y remoto). */
export function attentionCount(queue: Pick<PendingReceipt, "clientTransactionId" | "status">[], history: Pick<RemoteLike, "clientTransactionId" | "status">[] = []) {
  const ids = new Set<string>();
  for (const item of queue) if (item.status === "ERROR" || item.status === "REJECTED") ids.add(item.clientTransactionId);
  for (const item of history) if (item.status === "ERROR" || item.status === "REJECTED") ids.add(item.clientTransactionId);
  return ids.size;
}

/** Pendientes de enviar o confirmar: lo local que aún no tiene resultado final ni error. */
export function awaitingSendCount(queue: Pick<PendingReceipt, "status">[]) {
  return queue.filter((item) => item.status === "PENDING" || item.status === "SYNCING").length;
}
