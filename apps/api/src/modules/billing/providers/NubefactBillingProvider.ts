import type { BillingProvider } from "../BillingProvider.js";
import type { BillingIssueResult, IssueDocumentCommand, ProviderHealth } from "../contracts.js";
import { IGV_PERCENT, priceItems } from "../../receipts/pricing.js";

/**
 * Adaptador nativo de Nubefact (OSE/PSE autorizado por SUNAT).
 *
 * Contrato según el "Manual de integración archivo JSON" oficial de Nubefact:
 * - Todas las operaciones son POST a la RUTA única de la cuenta con
 *   `Authorization: <token>` y `Content-Type: application/json`.
 * - Operaciones: generar_comprobante, consultar_comprobante.
 * - Errores: `{ "errors": "...", "codigo": N }`. 23 = el documento ya existe,
 *   24 = el documento no existe.
 *
 * Cada negocio tiene su propia cuenta (ruta + token) porque el emisor (RUC)
 * lo determina la cuenta, no el JSON.
 */
export type NubefactProviderOptions = {
  /** RUTA de la cuenta, ej. https://api.nubefact.com/api/v1/xxxxxxxx */
  url: string;
  token: string;
  timeoutMs?: number;
};

type NubefactResponse = {
  tipo_de_comprobante?: number;
  serie?: string;
  numero?: number;
  enlace?: string;
  enlace_del_pdf?: string;
  enlace_del_xml?: string;
  enlace_del_cdr?: string;
  aceptada_por_sunat?: boolean;
  sunat_description?: string | null;
  sunat_note?: string | null;
  sunat_responsecode?: string | null;
  sunat_soap_error?: string | null;
  anulado?: boolean;
  cadena_para_codigo_qr?: string;
  codigo_hash?: string;
  cdr_zip_base64?: string;
  errors?: string;
  codigo?: number;
};

const TIPO_COMPROBANTE = { FACTURA: 1, BOLETA: 2, NOTA_CREDITO: 3 } as const;
const TIPO_DOCUMENTO_MODIFICADO = { FACTURA: 1, BOLETA: 2 } as const;

/** Códigos de error de Nubefact que indican configuración/cuenta, no datos de la venta. */
const ACCOUNT_ERROR_CODES = new Set([10, 11, 12, 50, 51]);
const ALREADY_EXISTS = 23;
const DOES_NOT_EXIST = 24;

function limaDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Fecha de emisión inválida");
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Lima", day: "2-digit", month: "2-digit", year: "numeric" }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("day")}-${get("month")}-${get("year")}`;
}

function clientFields(command: IssueDocumentCommand) {
  const customer = command.customer;
  if (!customer?.documentNumber) {
    return {
      cliente_tipo_de_documento: "-",
      cliente_numero_de_documento: "-",
      cliente_denominacion: (customer?.name || "CLIENTES VARIOS").slice(0, 100),
      cliente_direccion: ""
    };
  }
  return {
    cliente_tipo_de_documento: customer.documentType === "RUC" ? "6" : "1",
    cliente_numero_de_documento: customer.documentNumber,
    cliente_denominacion: (customer.name || "CLIENTE").slice(0, 100),
    cliente_direccion: (customer.address ?? "").slice(0, 100)
  };
}

const PAYMENT_LABEL: Record<string, string> = {
  EFECTIVO: "EFECTIVO",
  YAPE: "YAPE",
  PLIN: "PLIN",
  TARJETA: "TARJETA",
  TRANSFERENCIA: "TRANSFERENCIA BANCARIA"
};

export function mapCommandToNubefact(command: IssueDocumentCommand) {
  if (command.documentType === "FACTURA") {
    if (command.customer?.documentType !== "RUC") throw new Error("Para emitir una factura el cliente debe tener RUC.");
    if (!command.customer.address?.trim()) throw new Error("Para emitir una factura se necesita la dirección del cliente.");
  }
  if (command.documentType === "NOTA_CREDITO" && (!command.relatedDocument || !command.creditNoteReason)) {
    throw new Error("La nota de crédito debe indicar el comprobante que modifica y el motivo.");
  }

  const priced = priceItems(command.items);
  if (Math.abs(priced.total - command.total) > 0.01) {
    throw new Error("El total del comprobante no coincide con el detalle. No se envió a SUNAT.");
  }

  const note = command.documentType === "NOTA_CREDITO" && command.relatedDocument && command.creditNoteReason
    ? {
        documento_que_se_modifica_tipo: TIPO_DOCUMENTO_MODIFICADO[command.relatedDocument.documentType],
        documento_que_se_modifica_serie: command.relatedDocument.series,
        documento_que_se_modifica_numero: command.relatedDocument.correlative,
        tipo_de_nota_de_credito: Number(command.creditNoteReason.code),
        observaciones: command.creditNoteReason.description.slice(0, 1000)
      }
    : {};

  return {
    operacion: "generar_comprobante",
    tipo_de_comprobante: TIPO_COMPROBANTE[command.documentType],
    serie: command.series,
    numero: command.correlative,
    sunat_transaction: 1,
    ...clientFields(command),
    fecha_de_emision: limaDate(command.issueDate),
    moneda: 1,
    porcentaje_de_igv: IGV_PERCENT,
    total_gravada: priced.subtotal,
    total_igv: priced.igv,
    total: priced.total,
    enviar_automaticamente_a_la_sunat: true,
    enviar_automaticamente_al_cliente: false,
    ...(command.paymentMethod && command.documentType !== "NOTA_CREDITO"
      ? { medio_de_pago: PAYMENT_LABEL[command.paymentMethod] ?? command.paymentMethod, cancelado: true }
      : {}),
    ...note,
    items: command.items.map((item, index) => {
      const line = priced.lines[index];
      return {
        unidad_de_medida: item.unitCode === "ZZ" || item.unitCode === "Servicio" ? "ZZ" : "NIU",
        ...(item.sku ? { codigo: item.sku.slice(0, 250) } : {}),
        descripcion: item.description.slice(0, 250),
        cantidad: line.quantity,
        valor_unitario: line.unitValue,
        precio_unitario: line.unitPrice,
        subtotal: line.lineSubtotal,
        tipo_de_igv: 1,
        igv: line.lineIgv,
        total: line.lineTotal,
        anticipo_regularizacion: false
      };
    })
  };
}

function officialNumber(command: IssueDocumentCommand) {
  return `${command.series}-${String(command.correlative).padStart(8, "0")}`;
}

/** SUNAT: 0 = aceptado; 2000-3999 = rechazo; 4000+ = aceptado con observaciones. */
function isSunatRejection(code: string | null | undefined) {
  const numeric = Number(code);
  return Number.isFinite(numeric) && numeric >= 2000 && numeric < 4000;
}

export function interpretNubefactResponse(command: IssueDocumentCommand, httpStatus: number, payload: NubefactResponse): BillingIssueResult {
  const number = officialNumber(command);
  const base = { providerCode: "nubefact" as const, officialNumber: number };

  if (payload.errors || payload.codigo) {
    const message = payload.errors || `Nubefact respondió con el código ${payload.codigo}`;
    if (payload.codigo === ALREADY_EXISTS) {
      return { ...base, status: "PENDING", message: "Nubefact ya tenía este comprobante; se consultará su estado.", artifacts: { rawResponse: payload } };
    }
    if (payload.codigo !== undefined && ACCOUNT_ERROR_CODES.has(payload.codigo)) {
      throw new Error(`Nubefact rechazó la configuración de la cuenta: ${message}`);
    }
    if (payload.codigo === 40 || httpStatus >= 500) {
      return { ...base, status: "PENDING", message: `Nubefact no pudo procesar el envío: ${message}`, artifacts: { rawResponse: payload } };
    }
    return { providerCode: "nubefact", status: "REJECTED", message, artifacts: { rawResponse: payload } };
  }

  if (httpStatus >= 500) {
    return { ...base, status: "PENDING", message: `Nubefact respondió HTTP ${httpStatus}; se conciliará el estado.`, artifacts: { rawResponse: payload } };
  }

  const artifacts = {
    hash: payload.codigo_hash,
    qrData: payload.cadena_para_codigo_qr,
    cdrZipBase64: payload.cdr_zip_base64,
    rawResponse: payload
  };
  const links = {
    pdfUrl: payload.enlace_del_pdf || (payload.enlace ? `${payload.enlace}.pdf` : undefined),
    xmlUrl: payload.enlace_del_xml || undefined,
    cdrUrl: payload.enlace_del_cdr || undefined
  };

  if (payload.aceptada_por_sunat === true) {
    return {
      ...base,
      ...links,
      status: "ACCEPTED",
      providerDocumentId: payload.enlace,
      message: payload.sunat_description || "Comprobante aceptado por SUNAT.",
      artifacts
    };
  }
  if (isSunatRejection(payload.sunat_responsecode)) {
    return {
      ...base,
      ...links,
      status: "REJECTED",
      providerDocumentId: payload.enlace,
      message: payload.sunat_description || `SUNAT rechazó el comprobante (código ${payload.sunat_responsecode}).`,
      artifacts
    };
  }
  // Nubefact recibió y firmó el documento, pero SUNAT aún no confirma (las
  // boletas suelen informarse después). Queda pendiente y se concilia.
  return {
    ...base,
    ...links,
    status: "PENDING",
    providerDocumentId: payload.enlace,
    message: payload.sunat_soap_error || payload.sunat_description || "Comprobante recibido por Nubefact; SUNAT aún no confirma.",
    artifacts
  };
}

export class NubefactBillingProvider implements BillingProvider {
  readonly code = "nubefact" as const;
  private readonly timeoutMs: number;

  constructor(private readonly options: NubefactProviderOptions) {
    this.timeoutMs = options.timeoutMs ?? 20000;
  }

  async health(): Promise<ProviderHealth> {
    // Consulta no destructiva de un documento inexistente: si responde
    // código 24 la ruta y el token son válidos.
    try {
      const response = await this.post({ operacion: "consultar_comprobante", tipo_de_comprobante: 2, serie: "B999", numero: 99999999 });
      const payload = await response.json().catch(() => ({})) as NubefactResponse;
      if (payload.codigo !== undefined && ACCOUNT_ERROR_CODES.has(payload.codigo)) return "DOWN";
      if (response.status === 401) return "DOWN";
      if (response.status >= 500) return "DEGRADED";
      return "UP";
    } catch {
      return "DOWN";
    }
  }

  async issueDocument(command: IssueDocumentCommand): Promise<BillingIssueResult> {
    const body = mapCommandToNubefact(command);
    let response: Response;
    try {
      response = await this.post(body);
    } catch (error) {
      // Resultado incierto: no se asume rechazo ni se reemite a ciegas.
      return {
        providerCode: this.code,
        status: "PENDING",
        officialNumber: officialNumber(command),
        message: `Resultado incierto con Nubefact: ${error instanceof Error ? error.message : "sin respuesta"}. Se consultará el estado.`
      };
    }
    const payload = await response.json().catch(() => ({})) as NubefactResponse;
    return interpretNubefactResponse(command, response.status, payload);
  }

  async getDocumentStatus(command: IssueDocumentCommand): Promise<BillingIssueResult> {
    try {
      const response = await this.post({
        operacion: "consultar_comprobante",
        tipo_de_comprobante: TIPO_COMPROBANTE[command.documentType],
        serie: command.series,
        numero: command.correlative
      });
      const payload = await response.json().catch(() => ({})) as NubefactResponse;
      if (payload.codigo === DOES_NOT_EXIST) {
        return { providerCode: this.code, status: "PENDING", officialNumber: officialNumber(command), message: "Nubefact no tiene registrado este comprobante todavía." };
      }
      if (payload.codigo !== undefined && ACCOUNT_ERROR_CODES.has(payload.codigo)) {
        return { providerCode: this.code, status: "PENDING", officialNumber: officialNumber(command), message: `No pudimos consultar el estado: ${payload.errors ?? payload.codigo}` };
      }
      if (payload.errors) {
        return { providerCode: this.code, status: "PENDING", officialNumber: officialNumber(command), message: `No pudimos consultar el estado: ${payload.errors}` };
      }
      return interpretNubefactResponse(command, response.status, payload);
    } catch (error) {
      return {
        providerCode: this.code,
        status: "PENDING",
        officialNumber: officialNumber(command),
        message: `No pudimos consultar el estado: ${error instanceof Error ? error.message : "sin respuesta"}`
      };
    }
  }

  private async post(body: unknown) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(this.options.url, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: this.options.token,
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify(body)
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}
