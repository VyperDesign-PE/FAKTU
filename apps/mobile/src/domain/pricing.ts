/**
 * Totales de una venta con IGV incluido. Réplica exacta del cálculo del servidor
 * (apps/api/src/modules/receipts/pricing.ts): cada línea se redondea a céntimos y
 * luego se suma. El servidor sigue siendo la autoridad; esto solo muestra lo mismo
 * que va a emitir. tests/domain.ts compara ambas implementaciones.
 */
export const IGV_RATE = 0.18;

export type PriceableItem = { quantity: number; unitPrice: number };

export function lineTotalCents(item: PriceableItem) {
  return Math.round((item.quantity * item.unitPrice + Number.EPSILON) * 100);
}

export function quoteTotals(items: PriceableItem[]) {
  let subtotalCents = 0;
  let totalCents = 0;
  for (const item of items) {
    const line = lineTotalCents(item);
    totalCents += line;
    subtotalCents += Math.round(line / (1 + IGV_RATE));
  }
  return { subtotal: subtotalCents / 100, igv: (totalCents - subtotalCents) / 100, total: totalCents / 100, totalCents };
}
