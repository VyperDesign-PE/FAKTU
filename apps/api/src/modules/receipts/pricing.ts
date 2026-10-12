/**
 * Cálculo de montos de un comprobante gravado con IGV.
 *
 * Fuente única de verdad: el servidor recalcula todo a partir de los ítems
 * (cantidad x precio unitario con IGV). El total que envía el celular solo se
 * usa para detectar discrepancias, nunca se guarda tal cual.
 *
 * La cabecera es siempre la suma de las líneas, de modo que
 * mtoOperGravadas / mtoIGV / mtoImpVenta cuadran exactamente con el detalle
 * que se envía al proveedor (SUNAT valida esa consistencia).
 */
export const IGV_RATE = 0.18;
export const IGV_PERCENT = 18;

export type PricingItemInput = {
  quantity: number;
  unitPrice: number;
};

export type PricedLine = {
  quantity: number;
  /** Precio unitario con IGV. */
  unitPrice: number;
  /** Valor unitario sin IGV. */
  unitValue: number;
  lineSubtotal: number;
  lineIgv: number;
  lineTotal: number;
};

export type PricedReceipt = {
  lines: PricedLine[];
  subtotal: number;
  igv: number;
  total: number;
};

function toCents(value: number) {
  return Math.round((value + Number.EPSILON) * 100);
}

function fromCents(cents: number) {
  return cents / 100;
}

export function roundTo(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function priceItems(items: PricingItemInput[]): PricedReceipt {
  let subtotalCents = 0;
  let igvCents = 0;
  let totalCents = 0;

  const lines = items.map((item) => {
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) throw new Error("Cantidad inválida");
    if (!Number.isFinite(item.unitPrice) || item.unitPrice < 0) throw new Error("Precio inválido");
    const quantity = roundTo(item.quantity, 4);
    const unitPrice = roundTo(item.unitPrice, 6);
    const lineTotalCents = toCents(quantity * unitPrice);
    const lineSubtotalCents = Math.round(lineTotalCents / (1 + IGV_RATE));
    const lineIgvCents = lineTotalCents - lineSubtotalCents;

    subtotalCents += lineSubtotalCents;
    igvCents += lineIgvCents;
    totalCents += lineTotalCents;

    return {
      quantity,
      unitPrice,
      unitValue: roundTo(fromCents(lineSubtotalCents) / quantity, 10),
      lineSubtotal: fromCents(lineSubtotalCents),
      lineIgv: fromCents(lineIgvCents),
      lineTotal: fromCents(lineTotalCents)
    };
  });

  return {
    lines,
    subtotal: fromCents(subtotalCents),
    igv: fromCents(igvCents),
    total: fromCents(totalCents)
  };
}

/** Tolerancia de 1 céntimo entre el total mostrado en el celular y el recalculado. */
export function totalsMatch(clientTotal: number, serverTotal: number) {
  return Math.abs(toCents(clientTotal) - toCents(serverTotal)) <= 1;
}
