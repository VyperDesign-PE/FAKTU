import { findCustomerByDocument, upsertCustomer } from "../customers/customerRepository.js";
import { recordDocumentLookup } from "../customers/documentLookupUsageRepository.js";
import { findSunatRuc } from "../sunatRuc/sunatRucRegistryRepository.js";
import { consultarDocumentoCliente as consultarProveedor } from "./consultarDocumentoCliente.js";
import { lookupRucFromSources } from "./rucLookupService.js";
import { CustomerDocumentLookupError, type CustomerDocumentResult, type DocumentType } from "./types.js";

function normalize(tipoDoc: DocumentType, numero: string) {
  const clean = numero.replace(/\D/g, "");
  const expected = tipoDoc === "DNI" ? 8 : 11;
  if (clean.length !== expected) {
    throw new CustomerDocumentLookupError(
      tipoDoc === "DNI" ? "El DNI debe tener 8 dígitos." : "El RUC debe tener 11 dígitos.",
      "INVALID_DOCUMENT",
      false,
      400
    );
  }
  return clean;
}

function estimatedExternalCost(tipoDoc: DocumentType) {
  if (tipoDoc === "RUC") return Number(process.env.DOCUMENT_LOOKUP_RUC_COST_PEN ?? 0);
  return Number(process.env.DOCUMENT_LOOKUP_DNI_COST_PEN ?? 0);
}

function isExternalLookup(result: CustomerDocumentResult) {
  return !["MOCK", "SUNAT_RUC_PADRON", "CACHE_SERVER"].includes(result.source);
}

async function returnCached(
  tenantId: string,
  tipoDoc: DocumentType,
  clean: string,
  cached: Awaited<ReturnType<typeof findCustomerByDocument>>
): Promise<CustomerDocumentResult> {
  if (!cached) throw new Error("cache requerido");
  await recordDocumentLookup({
    tenantId,
    documentType: tipoDoc,
    documentNumber: clean,
    lookupSource: "CACHE_SERVER",
    providerCode: cached.dataSource,
    externalLookup: false,
    estimatedCost: 0,
    successful: true
  });
  return {
    tipoDoc,
    numero: clean,
    nombreCompleto: cached.fullName,
    direccion: cached.address,
    source: "CACHE_SERVER",
    originalSource: cached.dataSource,
    customerId: cached.id
  };
}

/**
 * Estrategia multi-tenant:
 * - DNI: cliente del negocio -> proveedor DNI solo si es nuevo.
 * - RUC: Padrón oficial SUNAT local (gratis y actualizado) -> cliente del negocio -> respaldo externo.
 *
 * Para RUC consultamos primero el índice oficial global porque no tiene costo por consulta y así
 * evitamos que una razón social/dirección cacheada por el tenant quede obsoleta durante meses.
 */
export async function lookupCustomerDocument(
  tenantId: string,
  tipoDoc: DocumentType,
  numero: string,
  signal?: AbortSignal
): Promise<CustomerDocumentResult> {
  const clean = normalize(tipoDoc, numero);
  const cached = await findCustomerByDocument(tenantId, tipoDoc, clean);

  if (tipoDoc === "DNI" && cached) return returnCached(tenantId, tipoDoc, clean, cached);

  if (tipoDoc === "RUC") {
    const official = await findSunatRuc(clean);
    if (official) {
      const customer = await upsertCustomer({
        tenantId,
        documentType: "RUC",
        documentNumber: clean,
        fullName: official.legalName,
        address: official.fiscalAddress,
        dataSource: "SUNAT_RUC_PADRON",
        verifiedAt: new Date()
      });

      await recordDocumentLookup({
        tenantId,
        documentType: "RUC",
        documentNumber: clean,
        lookupSource: "SUNAT_RUC_PADRON",
        providerCode: "SUNAT_OPEN_DATA",
        externalLookup: false,
        estimatedCost: 0,
        successful: true
      });

      return {
        tipoDoc: "RUC",
        numero: clean,
        nombreCompleto: official.legalName,
        direccion: official.fiscalAddress,
        estado: official.taxpayerStatus,
        condicion: official.domicileCondition,
        source: "SUNAT_RUC_PADRON",
        sourceUpdatedAt: official.sourceUpdatedAt,
        customerId: customer.id
      };
    }

    // Si el padrón todavía no contiene un RUC recientemente creado, conservamos la posibilidad
    // de usar un cliente previamente guardado o un proveedor externo de respaldo.
    if (cached) return returnCached(tenantId, tipoDoc, clean, cached);
  }

  const cost = estimatedExternalCost(tipoDoc);
  try {
    const result = tipoDoc === "RUC"
      ? await lookupRucFromSources(clean, signal)
      : await consultarProveedor(tipoDoc, clean, signal);

    const customer = await upsertCustomer({
      tenantId,
      documentType: tipoDoc,
      documentNumber: clean,
      fullName: result.nombreCompleto,
      address: result.direccion,
      dataSource:
        result.source === "MOCK"
          ? "MOCK"
          : result.source === "SUNAT_RUC_PADRON"
            ? "SUNAT_RUC_PADRON"
            : tipoDoc === "RUC"
              ? "RUC_EXTERNAL"
              : "API_DNI",
      verifiedAt: new Date()
    });

    const externalLookup = isExternalLookup(result);
    await recordDocumentLookup({
      tenantId,
      documentType: tipoDoc,
      documentNumber: clean,
      lookupSource: result.source,
      providerCode: result.source === "SUNAT_RUC_PADRON" ? "SUNAT_OPEN_DATA" : result.source,
      externalLookup,
      estimatedCost: externalLookup ? cost : 0,
      successful: true
    });

    return { ...result, customerId: customer.id };
  } catch (error) {
    await recordDocumentLookup({
      tenantId,
      documentType: tipoDoc,
      documentNumber: clean,
      lookupSource: "EXTERNAL_ERROR",
      providerCode: tipoDoc === "RUC" ? "SUNAT_RUC_PADRON/FALLBACK" : process.env.DOCUMENT_LOOKUP_PROVIDER ?? "unknown",
      externalLookup: tipoDoc === "DNI",
      estimatedCost: tipoDoc === "DNI" ? cost : 0,
      successful: false
    }).catch(() => undefined);
    throw error;
  }
}
