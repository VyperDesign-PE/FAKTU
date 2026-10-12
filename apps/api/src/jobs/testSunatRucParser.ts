import assert from "node:assert/strict";
import { parseSunatRucLine } from "../modules/sunatRuc/sunatRucParser.js";

const row = parseSunatRucLine("20999999991|EMPRESA SINTETICA UNO SAC|ACTIVO|HABIDO|150101|AV.|PRUEBA|-|-|123|-|-|-|-|-|");
if (!row) throw new Error("El parser no devolvió una fila.");
assert.equal(row.ruc, "20999999991");
assert.equal(row.legalName, "EMPRESA SINTETICA UNO SAC");
assert.equal(row.taxpayerStatus, "ACTIVO");
assert.equal(row.domicileCondition, "HABIDO");
assert.equal(row.ubigeo, "150101");
assert.equal(row.fiscalAddress, "AV. PRUEBA NRO 123");

assert.equal(parseSunatRucLine("RUC|NOMBRE O RAZÓN SOCIAL|ESTADO DEL CONTRIBUYENTE|CONDICIÓN DE DOMICILIO|UBIGEO|TIPO DE VÍA|NOMBRE DE VÍA|CÓDIGO DE ZONA|TIPO DE ZONA|NÚMERO|INTERIOR|LOTE|DEPARTAMENTO|MANZANA|KILÓMETRO|"), null);

assert.throws(
  () => parseSunatRucLine("20999999991|FORMATO|INCOMPLETO"),
  /Formato SUNAT inesperado/
);

console.log("OK: parser Padrón Reducido RUC");
