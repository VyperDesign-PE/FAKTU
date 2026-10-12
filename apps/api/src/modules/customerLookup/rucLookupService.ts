import { findSunatRuc } from "../sunatRuc/sunatRucRegistryRepository.js";
import { consultarDocumentoCliente as consultarProveedor } from "./consultarDocumentoCliente.js";
import { CustomerDocumentLookupError, type CustomerDocumentResult } from "./types.js";

/**
 * Fuente RUC preferida:
 * 1) Padrón Reducido oficial de SUNAT, sincronizado a nuestra BD (costo por consulta: S/ 0).
 * 2) Proveedor externo configurado como respaldo si el RUC aún no aparece en el padrón local.
 */
export async function lookupRucFromSources(ruc: string, signal?: AbortSignal): Promise<CustomerDocumentResult> {
  const clean = ruc.replace(/\D/g, "");
  if (!/^\d{11}$/.test(clean)) {
    throw new CustomerDocumentLookupError("El RUC debe tener 11 dígitos.", "INVALID_DOCUMENT", false, 400);
  }

  const official = await findSunatRuc(clean);
  if (official) {
    return {
      tipoDoc: "RUC",
      numero: official.ruc,
      nombreCompleto: official.legalName,
      direccion: official.fiscalAddress,
      estado: official.taxpayerStatus,
      condicion: official.domicileCondition,
      source: "SUNAT_RUC_PADRON",
      sourceUpdatedAt: official.sourceUpdatedAt
    };
  }

  try {
    return await consultarProveedor("RUC", clean, signal);
  } catch (error) {
    if (
      error instanceof CustomerDocumentLookupError &&
      error.code === "UPSTREAM_UNAVAILABLE" &&
      (process.env.DOCUMENT_LOOKUP_PROVIDER ?? "mock").toLowerCase() === "mock"
    ) {
      throw new CustomerDocumentLookupError(
        "Ese RUC no está disponible en el padrón SUNAT cargado y no hay un proveedor de respaldo configurado. Puedes ingresar la razón social manualmente.",
        "UPSTREAM_UNAVAILABLE",
        false,
        503
      );
    }
    throw error;
  }
}
