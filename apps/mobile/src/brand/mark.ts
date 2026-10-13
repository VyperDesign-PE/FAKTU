/**
 * Geometría del isotipo FAKTU en un cuadrado unitario (0–1): una "F" con punto final menta
 * del comprobante aceptado. La usan <BrandMark /> y scripts/generate-icons.ts, de modo
 * que la app y los iconos instalables son siempre el mismo dibujo.
 */
export type Rect = { x: number; y: number; w: number; h: number };
export const MARK_BARS: Rect[] = [
  { x: 0.28, y: 0.26, w: 0.12, h: 0.5 }, // tallo
  { x: 0.28, y: 0.26, w: 0.38, h: 0.12 }, // brazo superior
  { x: 0.28, y: 0.47, w: 0.3, h: 0.11 } // brazo medio
];
export const MARK_DOT = { cx: 0.575, cy: 0.695, r: 0.065 }; // punto final: "F."
export const MARK_RADIUS = 0.26;
