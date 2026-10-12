import {
  CustomerDocumentLookupError,
  type CustomerDocumentResult,
  type DocumentType
} from "./types.js";

type ApiPeruDevResponse = {
  success?: boolean;
  code?: string;
  retryable?: boolean;
  message?: string;
  data?: {
    numero?: string;
    nombres?: string;
    apellido_paterno?: string;
    apellido_materno?: string;
    ruc?: string;
    nombre_o_razon_social?: string;
    direccion?: string;
    estado?: string;
    condicion?: string;
  };
};

const DNI_REGEX = /^\d{8}$/;
const RUC_REGEX = /^\d{11}$/;
const DEFAULT_TIMEOUT_MS = 8_000;

function validateDocument(tipoDoc: DocumentType, numero: string) {
  const clean = numero.replace(/\D/g, "");
  const valid = tipoDoc === "DNI" ? DNI_REGEX.test(clean) : RUC_REGEX.test(clean);

  if (!valid) {
    throw new CustomerDocumentLookupError(
      tipoDoc === "DNI" ? "El DNI debe tener 8 dígitos." : "El RUC debe tener 11 dígitos.",
      "INVALID_DOCUMENT",
      false,
      400
    );
  }

  return clean;
}

function normalizePersonName(data: NonNullable<ApiPeruDevResponse["data"]>) {
  return [data.nombres, data.apellido_paterno, data.apellido_materno]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Fixtures explícitos de desarrollo. Nunca se devuelve una empresa ficticia para
 * un documento real ingresado por el usuario: solo estos números reservados
 * producen datos simulados.
 */
function mockResult(tipoDoc: DocumentType, numero: string): CustomerDocumentResult {
  if (tipoDoc === "DNI" && numero === "00000000") {
    return {
      tipoDoc,
      numero,
      nombreCompleto: "CLIENTE DEMO - DATOS SIMULADOS",
      source: "MOCK"
    };
  }

  if (tipoDoc === "RUC" && numero === "20123456789") {
    return {
      tipoDoc,
      numero,
      nombreCompleto: "EMPRESA DEMO SAC - DATOS SIMULADOS",
      direccion: "DIRECCIÓN DEMO",
      estado: "ACTIVO",
      condicion: "HABIDO",
      source: "MOCK"
    };
  }

  throw new CustomerDocumentLookupError(
    "La consulta real de documentos todavía no está conectada en este entorno. Puedes ingresar los datos manualmente y continuar.",
    "UPSTREAM_UNAVAILABLE",
    false,
    503
  );
}

/**
 * Consulta DNI/RUC en un proveedor externo y normaliza la respuesta para el POS.
 * El token vive exclusivamente en el backend; nunca debe enviarse a Expo/React Native.
 */
export async function consultarDocumentoCliente(
  tipoDoc: DocumentType,
  numero: string,
  signal?: AbortSignal
): Promise<CustomerDocumentResult> {
  const clean = validateDocument(tipoDoc, numero);
  const provider = (process.env.DOCUMENT_LOOKUP_PROVIDER ?? "mock").toLowerCase();

  if (provider === "mock") return mockResult(tipoDoc, clean);

  const baseUrl = (process.env.DOCUMENT_LOOKUP_API_BASE_URL ?? "https://api.apiperu.dev").replace(/\/$/, "");
  const token = process.env.DOCUMENT_LOOKUP_API_TOKEN;

  if (!token) {
    throw new CustomerDocumentLookupError(
      "El servicio de consulta de documentos no está configurado.",
      "CONFIGURATION_ERROR",
      false,
      500
    );
  }

  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), Number(process.env.DOCUMENT_LOOKUP_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS));
  const abort = () => timeoutController.abort();
  signal?.addEventListener("abort", abort, { once: true });

  try {
    const response = await fetch(`${baseUrl}/${tipoDoc === "DNI" ? "dni" : "ruc"}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(tipoDoc === "DNI" ? { dni: clean } : { ruc: clean }),
      signal: timeoutController.signal
    });

    const payload = (await response.json().catch(() => ({}))) as ApiPeruDevResponse;

    if (response.status === 404 || payload.code === "document_not_found") {
      throw new CustomerDocumentLookupError(
        tipoDoc === "DNI" ? "No encontramos ese DNI." : "No encontramos ese RUC.",
        "NOT_FOUND",
        false,
        404
      );
    }

    if (response.status === 503 || payload.code === "upstream_unavailable") {
      throw new CustomerDocumentLookupError(
        "El servicio de consulta no está disponible por el momento. Puedes completar el nombre manualmente.",
        "UPSTREAM_UNAVAILABLE",
        true,
        503
      );
    }

    if (!response.ok || payload.success === false || !payload.data) {
      throw new CustomerDocumentLookupError(
        payload.message ?? "No pudimos consultar el documento. Puedes completar los datos manualmente.",
        "UPSTREAM_ERROR",
        Boolean(payload.retryable),
        response.status >= 400 ? response.status : 502
      );
    }

    const nombreCompleto = tipoDoc === "DNI"
      ? normalizePersonName(payload.data)
      : payload.data.nombre_o_razon_social?.trim() ?? "";

    if (!nombreCompleto) {
      throw new CustomerDocumentLookupError(
        "La consulta respondió sin nombre. Puedes completarlo manualmente.",
        "UPSTREAM_ERROR",
        false,
        502
      );
    }

    return {
      tipoDoc,
      numero: clean,
      nombreCompleto,
      direccion: payload.data.direccion?.trim(),
      estado: payload.data.estado?.trim(),
      condicion: payload.data.condicion?.trim(),
      source: provider === "apiperudev" ? "APIPERU_DEV" : "EXTERNAL"
    };
  } catch (error) {
    if (error instanceof CustomerDocumentLookupError) throw error;

    if (error instanceof Error && error.name === "AbortError") {
      throw new CustomerDocumentLookupError(
        "La consulta tardó demasiado. Puedes escribir el nombre manualmente e intentar otra vez después.",
        "UPSTREAM_UNAVAILABLE",
        true,
        504
      );
    }

    throw new CustomerDocumentLookupError(
      "No pudimos comunicarnos con el servicio de consulta. Puedes escribir el nombre manualmente.",
      "UPSTREAM_UNAVAILABLE",
      true,
      503
    );
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}
