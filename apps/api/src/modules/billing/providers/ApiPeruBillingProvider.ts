import type { BillingProvider } from "../BillingProvider.js";
import type {
  BillingIssueResult,
  BillingIssuer,
  DespatchCommand,
  DespatchResult,
  IssueDocumentCommand,
  ProviderHealth,
  VoidingCommand,
  VoidingResult
} from "../contracts.js";
import { amountInWordsPen } from "../amountInWords.js";
import { IGV_PERCENT, priceItems } from "../../receipts/pricing.js";

export type ApiPeruBillingProviderOptions = {
  baseUrl?: string;
  token: string;
  issuer: BillingIssuer;
  timeoutMs?: number;
};

type ApiPeruCdrResponse = {
  accepted?: boolean;
  id?: string;
  code?: string;
  description?: string;
  notes?: string[];
};

type ApiPeruSunatResponse = {
  success?: boolean;
  error?: { code?: string; message?: string };
  cdrZip?: string;
  cdrResponse?: ApiPeruCdrResponse;
};

type ApiPeruSendResponse = {
  xml?: string;
  hash?: string;
  sunatResponse?: ApiPeruSunatResponse;
  message?: string;
  error?: { code?: string; message?: string };
};

type ApiPeruStatusResponse = {
  success?: boolean;
  error?: { code?: string; message?: string };
  code?: string;
  cdrZip?: string;
  cdrResponse?: ApiPeruCdrResponse;
};

function formatLimaIso(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Fecha de emision invalida");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}-05:00`;
}

function customerPayload(command: IssueDocumentCommand) {
  const customer = command.customer;
  if (!customer?.documentNumber) {
    return { tipoDoc: "0", numDoc: "00000000", rznSocial: customer?.name || "CLIENTES VARIOS" };
  }
  return {
    tipoDoc: customer.documentType === "RUC" ? "6" : "1",
    numDoc: customer.documentNumber,
    rznSocial: customer.name || "CLIENTE",
    ...(customer.address ? { address: { direccion: customer.address } } : {})
  };
}

function companyPayload(issuer: BillingIssuer) {
  const address = issuer.address;
  return {
    ruc: issuer.ruc,
    razonSocial: issuer.legalName,
    nombreComercial: issuer.tradeName || issuer.legalName,
    ...(address && (address.address || address.ubigeo || address.department || address.province || address.district)
      ? {
          address: {
            ...(address.address ? { direccion: address.address } : {}),
            ...(address.province ? { provincia: address.province } : {}),
            ...(address.department ? { departamento: address.department } : {}),
            ...(address.district ? { distrito: address.district } : {}),
            ...(address.ubigeo ? { ubigueo: address.ubigeo } : {})
          }
        }
      : {})
  };
}

const SUNAT_DOC_TYPE = { FACTURA: "01", BOLETA: "03", NOTA_CREDITO: "07", NOTA_DEBITO: "08" } as const;

export function mapCommandToApiPeru(command: IssueDocumentCommand, issuer: BillingIssuer) {
  if (!/^\d{11}$/.test(issuer.ruc)) throw new Error("El negocio debe tener un RUC valido antes de emitir.");
  if (!issuer.legalName?.trim()) throw new Error("El negocio debe tener razon social antes de emitir.");
  if (command.documentType === "FACTURA" && command.customer?.documentType !== "RUC") {
    throw new Error("Para emitir una factura el cliente debe tener RUC.");
  }
  const isNote = command.documentType === "NOTA_CREDITO" || command.documentType === "NOTA_DEBITO";
  if (isNote && (!command.relatedDocument || !command.noteReason)) {
    throw new Error("La nota debe indicar el comprobante que modifica y el motivo.");
  }

  // Detalle y cabecera salen del mismo cálculo, así la suma de líneas cuadra
  // exactamente con mtoOperGravadas / mtoIGV / mtoImpVenta.
  const priced = priceItems(command.items);
  if (Math.abs(priced.total - command.total) > 0.01) {
    throw new Error("El total del comprobante no coincide con el detalle. No se envió a SUNAT.");
  }

  const details = command.items.map((item, index) => {
    const line = priced.lines[index];
    return {
      ...(item.sku ? { codProducto: item.sku } : {}),
      unidad: item.unitCode || "NIU",
      descripcion: item.description,
      cantidad: line.quantity,
      mtoValorUnitario: line.unitValue,
      mtoValorVenta: line.lineSubtotal,
      mtoBaseIgv: line.lineSubtotal,
      porcentajeIgv: IGV_PERCENT,
      igv: line.lineIgv,
      tipAfeIgv: 10,
      totalImpuestos: line.lineIgv,
      mtoPrecioUnitario: line.unitPrice
    };
  });

  return {
    ublVersion: "2.1",
    // tipoOperacion (catálogo 51) solo existe en facturas y boletas, no en notas.
    ...(isNote ? {} : { tipoOperacion: "0101" }),
    tipoDoc: SUNAT_DOC_TYPE[command.documentType],
    serie: command.series,
    correlativo: String(command.correlative),
    fechaEmision: formatLimaIso(command.issueDate),
    ...(isNote
      ? {
          tipDocAfectado: SUNAT_DOC_TYPE[command.relatedDocument!.documentType],
          numDocfectado: `${command.relatedDocument!.series}-${command.relatedDocument!.correlative}`,
          codMotivo: command.noteReason!.code,
          desMotivo: command.noteReason!.description
        }
      : { formaPago: { moneda: command.currency, tipo: "Contado" } }),
    tipoMoneda: command.currency,
    client: customerPayload(command),
    company: companyPayload(issuer),
    mtoOperGravadas: priced.subtotal,
    mtoIGV: priced.igv,
    valorVenta: priced.subtotal,
    totalImpuestos: priced.igv,
    subTotal: priced.total,
    mtoImpVenta: priced.total,
    details,
    legends: [{ code: "1000", value: amountInWordsPen(priced.total) }]
  };
}

/**
 * SUNAT responde 1033 ("registrado previamente") cuando la misma serie y
 * correlativo ya fue recibida, por ejemplo si reenviamos tras perder la
 * respuesta. No es un rechazo: hay que conciliar por estado.
 */
export function isAlreadyRegisteredResponse(payload: ApiPeruSendResponse) {
  const codes = [payload.error?.code, payload.sunatResponse?.error?.code, payload.sunatResponse?.cdrResponse?.code];
  if (codes.some((code) => String(code ?? "").trim() === "1033")) return true;
  const text = [payload.message, payload.error?.message, payload.sunatResponse?.error?.message, payload.sunatResponse?.cdrResponse?.description].join(" ");
  return /registrado previamente/i.test(text);
}

type ValidationError = { field?: string; message?: string };

function messageFromResponse(payload: ApiPeruSendResponse | ApiPeruStatusResponse | ValidationError[], fallback: string) {
  // Errores de validación (HTTP 400): lista de { field, message } según el OpenAPI oficial.
  if (Array.isArray(payload)) {
    const text = payload.map((item) => [item.field, item.message].filter(Boolean).join(": ")).filter(Boolean).join(" · ");
    return text ? `Datos rechazados por APIsPERU: ${text}` : fallback;
  }
  const cdr = "cdrResponse" in payload
    ? payload.cdrResponse
    : "sunatResponse" in payload
      ? payload.sunatResponse?.cdrResponse
      : undefined;
  const error = payload.error ?? ("sunatResponse" in payload ? payload.sunatResponse?.error : undefined);
  const base = cdr?.description || error?.message || ("message" in payload ? payload.message : undefined) || fallback;
  const code = cdr?.code && cdr.code !== "0" ? cdr.code : error?.code;
  return code && !base.includes(String(code)) ? `${base} (código SUNAT ${code})` : base;
}

/**
 * Clasifica la respuesta de SUNAT (BillResult / StatusResult) según los rangos
 * oficiales de códigos:
 * - CDR aceptado (código 0 o 4000+ con observaciones) → ACEPTADO.
 * - CDR no aceptado, o error 1000-3999 (datos inválidos / rechazo) → RECHAZADO.
 * - 1033 (registrado previamente), 0100-0999 (excepciones del servicio SUNAT,
 *   p. ej. intermitencia), errores HTTP o sin CDR todavía → PENDIENTE: se
 *   concilia por estado, nunca se marca como rechazo ni se reemite a ciegas.
 */
export function classifySunatResult(result?: ApiPeruSunatResponse | ApiPeruStatusResponse): "ACCEPTED" | "REJECTED" | "PENDING" {
  const cdr = result?.cdrResponse;
  if (cdr?.accepted === true) return "ACCEPTED";
  if (cdr?.accepted === false) return "REJECTED";
  const rawCode = String(result?.error?.code ?? "").trim();
  if (!result?.error || rawCode === "1033") return "PENDING";
  const code = Number(rawCode);
  if (/^\d+$/.test(rawCode) && code >= 1000 && code < 4000) return "REJECTED";
  return "PENDING";
}

// ---------- Comunicación de baja / resumen de baja ----------

type ApiPeruSummaryResponse = {
  xml?: string;
  hash?: string;
  sunatResponse?: { success?: boolean; ticket?: string; error?: { code?: string; message?: string } };
};

/** Fecha AAAA-MM-DD (o ISO) a medianoche de Lima, como en los ejemplos oficiales. */
function limaMidnight(value: string) {
  // Una fecha calendario (AAAA-MM-DD) ya es fecha de Lima: no se convierte
  // desde UTC (eso la correría un día hacia atrás).
  const day = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : formatLimaIso(value).slice(0, 10);
  return `${day}T00:00:00-05:00`;
}

const CUSTOMER_ID_TYPE = { DNI: "1", RUC: "6" } as const;

/**
 * Facturas (y sus notas): comunicación de baja (voided/send).
 * Boletas: resumen diario con estado "3" = anulado (summary/send).
 */
export function mapVoidingToApiPeru(command: VoidingCommand, issuer: BillingIssuer) {
  const doc = command.document;
  const correlativo = String(command.correlative).padStart(3, "0");
  if (command.kind === "COMUNICACION_BAJA") {
    return {
      path: "voided/send",
      body: {
        correlativo,
        fecGeneracion: limaMidnight(doc.issueDate),
        fecComunicacion: limaMidnight(command.communicationDate),
        company: companyPayload(issuer),
        details: [{
          tipoDoc: SUNAT_DOC_TYPE[doc.documentType],
          serie: doc.series,
          correlativo: String(doc.correlative),
          desMotivoBaja: command.reason.toUpperCase().slice(0, 100)
        }]
      }
    };
  }
  const priced = { subtotal: doc.subtotal, igv: doc.igv, total: doc.total };
  return {
    path: "summary/send",
    body: {
      fecGeneracion: limaMidnight(doc.issueDate),
      fecResumen: limaMidnight(command.communicationDate),
      correlativo,
      moneda: "PEN",
      company: companyPayload(issuer),
      details: [{
        tipoDoc: SUNAT_DOC_TYPE[doc.documentType],
        serieNro: `${doc.series}-${doc.correlative}`,
        estado: "3",
        clienteTipo: doc.customer?.documentNumber ? CUSTOMER_ID_TYPE[doc.customer.documentType ?? "DNI"] : "0",
        clienteNro: doc.customer?.documentNumber ?? "00000000",
        total: priced.total,
        mtoOperGravadas: priced.subtotal,
        mtoIGV: priced.igv
      }]
    }
  };
}

/** Respuesta de envío de baja/resumen/guía: un ticket para consultar después. */
function interpretTicketResponse<T extends VoidingResult | DespatchResult>(payload: ApiPeruSummaryResponse | ValidationError[], httpStatus: number, what: string): T {
  if (Array.isArray(payload)) {
    return { providerCode: "apisperu", status: "REJECTED", message: messageFromResponse(payload, `APIsPERU rechazó la ${what}.`), rawResponse: payload } as T;
  }
  const sunat = payload.sunatResponse;
  if (sunat?.success && sunat.ticket) {
    return { providerCode: "apisperu", status: "PENDING", ticket: sunat.ticket, message: `${what[0].toUpperCase()}${what.slice(1)} enviada a SUNAT (ticket ${sunat.ticket}).`, rawResponse: payload } as T;
  }
  const status = httpStatus >= 500 ? "PENDING" : classifySunatResult(sunat as ApiPeruSunatResponse);
  return {
    providerCode: "apisperu",
    status,
    message: sunat?.error?.message ? `${sunat.error.message}${sunat.error.code ? ` (código SUNAT ${sunat.error.code})` : ""}` : `APIsPERU no devolvió ticket para la ${what} (HTTP ${httpStatus}).`,
    rawResponse: payload
  } as T;
}

/**
 * Estado de un ticket (voided/status, summary/status, despatch/status).
 * Solo un CDR explícito decide; "98" (en proceso) o sin CDR sigue pendiente.
 */
function interpretTicketStatus<T extends VoidingResult | DespatchResult>(payload: ApiPeruStatusResponse, ticket: string): T {
  const cdr = payload.cdrResponse;
  if (cdr) {
    const status = classifySunatResult(payload);
    return { providerCode: "apisperu", status, ticket, message: messageFromResponse(payload, status === "ACCEPTED" ? "Aceptado por SUNAT." : "Rechazado por SUNAT."), rawResponse: payload } as T;
  }
  if (payload.code === "99" && payload.error?.code && /^\d+$/.test(payload.error.code) && Number(payload.error.code) >= 1000) {
    return { providerCode: "apisperu", status: "REJECTED", ticket, message: messageFromResponse(payload, "SUNAT procesó el ticket con errores."), rawResponse: payload } as T;
  }
  return { providerCode: "apisperu", status: "PENDING", ticket, message: messageFromResponse(payload, "SUNAT aún está procesando el ticket."), rawResponse: payload } as T;
}

// ---------- Guías de remisión (Despatch, versión 2022) ----------

const GUIDE_DOC_TYPE = { REMITENTE: "09", TRANSPORTISTA: "31" } as const;
const TRANSFER_REASONS: Record<string, string> = {
  "01": "VENTA", "02": "COMPRA", "03": "VENTA CON ENTREGA A TERCEROS", "04": "TRASLADO ENTRE ESTABLECIMIENTOS DE LA MISMA EMPRESA",
  "05": "CONSIGNACION", "06": "DEVOLUCION", "07": "RECOJO DE BIENES TRANSFORMADOS", "08": "IMPORTACION", "09": "EXPORTACION",
  "13": "OTROS", "14": "VENTA SUJETA A CONFIRMACION DEL COMPRADOR", "17": "TRASLADO DE BIENES PARA TRANSFORMACION", "18": "TRASLADO EMISOR ITINERANTE CP"
};

export function mapDespatchToApiPeru(command: DespatchCommand, issuer: BillingIssuer) {
  const data = command.data;
  const isShipper = command.guideType === "REMITENTE";
  const usesOwnVehicle = !isShipper || data.transportMode === "02";
  if (!isShipper && !data.shipper) throw new Error("La guía de transportista requiere los datos del remitente.");
  if (isShipper && data.transportMode === "01" && !data.carrier) throw new Error("El transporte público requiere los datos de la empresa de transportes.");
  if (usesOwnVehicle && (!data.vehiclePlate || !data.driver)) throw new Error("El transporte privado requiere placa del vehículo y datos del conductor.");
  const party = (p: { documentType: string; documentNumber: string; name: string }) => ({ tipoDoc: p.documentType, numDoc: p.documentNumber, rznSocial: p.name });
  const reasonCode = isShipper ? data.reasonCode ?? "01" : "01";

  return {
    version: 2022,
    tipoDoc: GUIDE_DOC_TYPE[command.guideType],
    serie: command.series,
    correlativo: String(command.correlative),
    fechaEmision: formatLimaIso(command.issueDate),
    company: companyPayload(issuer),
    destinatario: party(data.recipient),
    ...(!isShipper && data.shipper ? { remitente: party(data.shipper) } : {}),
    ...(data.notes ? { observacion: data.notes.slice(0, 250) } : {}),
    ...(data.relatedDocument
      ? { addDocs: [{ tipo: SUNAT_DOC_TYPE[data.relatedDocument.documentType], tipoDesc: data.relatedDocument.documentType === "FACTURA" ? "Factura" : "Boleta de Venta", nro: `${data.relatedDocument.series}-${data.relatedDocument.correlative}`, emisor: issuer.ruc }] }
      : {}),
    envio: {
      codTraslado: reasonCode,
      desTraslado: reasonCode === "13" ? (data.reasonDescription ?? "OTROS").slice(0, 70) : TRANSFER_REASONS[reasonCode] ?? "VENTA",
      modTraslado: isShipper ? data.transportMode ?? "01" : "02",
      fecTraslado: limaMidnight(data.transferDate),
      pesoTotal: data.grossWeight,
      undPesoTotal: data.weightUnit,
      ...(isShipper && data.packages ? { numBultos: data.packages } : {}),
      partida: { ubigueo: data.origin.ubigeo, direccion: data.origin.address },
      llegada: { ubigueo: data.destination.ubigeo, direccion: data.destination.address },
      ...(isShipper && data.transportMode === "01" && data.carrier
        ? { transportista: { tipoDoc: "6", numDoc: data.carrier.documentNumber, rznSocial: data.carrier.name, ...(data.carrier.mtcNumber ? { nroMtc: data.carrier.mtcNumber } : {}) } }
        : {}),
      ...(usesOwnVehicle && data.driver
        ? {
            vehiculo: { placa: data.vehiclePlate },
            choferes: [{ tipo: "Principal", tipoDoc: data.driver.documentType, nroDoc: data.driver.documentNumber, nombres: data.driver.names, apellidos: data.driver.surnames, licencia: data.driver.license }]
          }
        : {})
    },
    details: data.items.map((item) => ({ cantidad: item.quantity, unidad: item.unit || "NIU", descripcion: item.description, ...(item.code ? { codigo: item.code } : {}) }))
  };
}

export class ApiPeruBillingProvider implements BillingProvider {
  readonly code = "apisperu" as const;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(private readonly options: ApiPeruBillingProviderOptions) {
    this.baseUrl = options.baseUrl ?? "https://facturacion.apisperu.com/api/v1/";
    this.timeoutMs = options.timeoutMs ?? 15000;
  }

  async health(): Promise<ProviderHealth> {
    try {
      const url = new URL("invoice/status", this.baseUrl);
      url.searchParams.set("tipo", "03");
      url.searchParams.set("serie", "B001");
      url.searchParams.set("numero", "0");
      url.searchParams.set("ruc", this.options.issuer.ruc);
      const response = await this.request(url, { method: "GET" });
      if (response.status === 401 || response.status === 403) return "DOWN";
      if (response.status >= 500) return "DOWN";
      // Un 400/404 es aceptable para esta prueba no destructiva: demuestra que
      // llegamos al endpoint sin emitir un documento.
      return "UP";
    } catch {
      return "DOWN";
    }
  }

  async issueDocument(command: IssueDocumentCommand): Promise<BillingIssueResult> {
    const body = mapCommandToApiPeru(command, this.options.issuer);
    let response: Response;
    try {
      // Notas de crédito: endpoint note/send (modelo Greenter). Validar en sandbox.
      const path = command.documentType === "NOTA_CREDITO" || command.documentType === "NOTA_DEBITO" ? "note/send" : "invoice/send";
      response = await this.request(new URL(path, this.baseUrl), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
    } catch (error) {
      // Si la conexion se corta despues del POST, NO asumimos rechazo ni reintentamos
      // a ciegas. El comprobante queda PENDING y se concilia por invoice/status.
      return {
        providerCode: this.code,
        status: "PENDING",
        officialNumber: `${command.series}-${command.correlative}`,
        message: error instanceof Error
          ? `Resultado incierto con APIsPERU: ${error.message}. Se debe consultar el estado antes de reintentar.`
          : "Resultado incierto con APIsPERU. Se debe consultar el estado antes de reintentar."
      };
    }

    const raw = await response.json().catch(() => ({})) as ApiPeruSendResponse | ValidationError[];
    if (Array.isArray(raw)) {
      // Validación de APIsPERU: el documento no llegó a SUNAT.
      return {
        providerCode: this.code,
        status: "REJECTED",
        message: messageFromResponse(raw, `APIsPERU respondió HTTP ${response.status}`),
        artifacts: { rawResponse: raw }
      };
    }
    const payload = raw;
    if (response.status === 401 || response.status === 403) {
      throw new Error("APIsPERU rechazo la credencial del negocio. Revisa el token configurado.");
    }
    if (response.status >= 500) {
      return {
        providerCode: this.code,
        status: "PENDING",
        officialNumber: `${command.series}-${command.correlative}`,
        message: messageFromResponse(payload, `APIsPERU respondio HTTP ${response.status}; se conciliara el estado antes de reintentar.`),
        artifacts: { rawResponse: payload }
      };
    }
    if (isAlreadyRegisteredResponse(payload)) {
      return {
        providerCode: this.code,
        status: "PENDING",
        officialNumber: `${command.series}-${command.correlative}`,
        message: "SUNAT ya había recibido este comprobante; se consultará su estado.",
        artifacts: { rawResponse: payload }
      };
    }
    if (!response.ok) {
      return {
        providerCode: this.code,
        status: "REJECTED",
        message: messageFromResponse(payload, `APIsPERU respondio HTTP ${response.status}`),
        artifacts: { rawResponse: payload }
      };
    }

    const sunat = payload.sunatResponse;
    const cdr = sunat?.cdrResponse;
    const status = classifySunatResult(sunat);
    const accepted = status === "ACCEPTED";
    return {
      providerCode: this.code,
      status,
      officialNumber: cdr?.id || `${command.series}-${command.correlative}`,
      providerDocumentId: cdr?.id,
      message: messageFromResponse(payload, accepted ? "Comprobante aceptado por SUNAT." : "Comprobante enviado; respuesta pendiente de confirmacion."),
      artifacts: {
        hash: payload.hash,
        xmlContent: payload.xml,
        cdrZipBase64: sunat?.cdrZip,
        rawResponse: payload
      }
    };
  }

  async getDocumentStatus(command: IssueDocumentCommand): Promise<BillingIssueResult> {
    const url = new URL("invoice/status", this.baseUrl);
    url.searchParams.set("tipo", SUNAT_DOC_TYPE[command.documentType]);
    url.searchParams.set("serie", command.series);
    url.searchParams.set("numero", String(command.correlative));
    url.searchParams.set("ruc", this.options.issuer.ruc);

    try {
      const response = await this.request(url, { method: "GET" });
      const payload = await response.json().catch(() => ({})) as ApiPeruStatusResponse;
      if (response.status === 404 || response.status === 400) {
        return { providerCode: this.code, status: "PENDING", officialNumber: `${command.series}-${command.correlative}`, message: messageFromResponse(payload, "SUNAT aun no devuelve un CDR para este comprobante.") };
      }
      if (!response.ok) {
        return { providerCode: this.code, status: "PENDING", officialNumber: `${command.series}-${command.correlative}`, message: messageFromResponse(payload, `No pudimos confirmar el estado (HTTP ${response.status}).`) };
      }
      const cdr = payload.cdrResponse;
      // En la consulta, un error sin CDR significa "aún no hay respuesta": solo
      // un CDR explícito decide aceptado o rechazado.
      const status = cdr ? classifySunatResult(payload) : "PENDING";
      const accepted = status === "ACCEPTED";
      return {
        providerCode: this.code,
        status,
        officialNumber: cdr?.id || `${command.series}-${command.correlative}`,
        providerDocumentId: cdr?.id,
        message: messageFromResponse(payload, accepted ? "Comprobante aceptado por SUNAT." : "Estado pendiente."),
        artifacts: { cdrZipBase64: payload.cdrZip, rawResponse: payload }
      };
    } catch (error) {
      return {
        providerCode: this.code,
        status: "PENDING",
        officialNumber: `${command.series}-${command.correlative}`,
        message: error instanceof Error ? `No pudimos confirmar el estado: ${error.message}` : "No pudimos confirmar el estado."
      };
    }
  }

  /**
   * Representación impresa oficial (con QR y hash) generada por APIsPERU
   * a partir del mismo JSON del comprobante: POST invoice/pdf o note/pdf.
   */
  async getDocumentPdf(command: IssueDocumentCommand): Promise<Buffer> {
    const body = mapCommandToApiPeru(command, this.options.issuer);
    const path = command.documentType === "NOTA_CREDITO" || command.documentType === "NOTA_DEBITO" ? "note/pdf" : "invoice/pdf";
    const response = await this.request(new URL(path, this.baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/pdf" },
      body: JSON.stringify(body)
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!response.ok || bytes.subarray(0, 4).toString("ascii") !== "%PDF") {
      throw new Error(`APIsPERU no generó el PDF (HTTP ${response.status}).`);
    }
    return bytes;
  }

  async requestVoiding(command: VoidingCommand): Promise<VoidingResult> {
    const { path, body } = mapVoidingToApiPeru(command, this.options.issuer);
    try {
      const response = await this.request(new URL(path, this.baseUrl), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (response.status === 401 || response.status === 403) throw new Error("APIsPERU rechazo la credencial del negocio. Revisa el token configurado.");
      return interpretTicketResponse<VoidingResult>(await response.json().catch(() => ({})), response.status, "comunicación de baja");
    } catch (error) {
      if (error instanceof Error && error.message.includes("credencial")) throw error;
      return { providerCode: this.code, status: "PENDING", message: `Resultado incierto con APIsPERU: ${error instanceof Error ? error.message : "sin respuesta"}.` };
    }
  }

  async getVoidingStatus(command: VoidingCommand, ticket?: string): Promise<VoidingResult> {
    // Sin ticket no hay nada que consultar: el envío no llegó a SUNAT.
    if (!ticket) return { providerCode: this.code, status: "PENDING", message: "La baja aún no tiene ticket de SUNAT." };
    const url = new URL(command.kind === "COMUNICACION_BAJA" ? "voided/status" : "summary/status", this.baseUrl);
    url.searchParams.set("ticket", ticket);
    url.searchParams.set("ruc", this.options.issuer.ruc);
    try {
      const response = await this.request(url, { method: "GET" });
      return interpretTicketStatus<VoidingResult>(await response.json().catch(() => ({})) as ApiPeruStatusResponse, ticket);
    } catch (error) {
      return { providerCode: this.code, status: "PENDING", ticket, message: `No pudimos consultar la baja: ${error instanceof Error ? error.message : "sin respuesta"}` };
    }
  }

  async issueDespatch(command: DespatchCommand): Promise<DespatchResult> {
    const body = mapDespatchToApiPeru(command, this.options.issuer);
    try {
      const response = await this.request(new URL("despatch/send", this.baseUrl), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (response.status === 401 || response.status === 403) throw new Error("APIsPERU rechazo la credencial del negocio. Revisa el token configurado.");
      return interpretTicketResponse<DespatchResult>(await response.json().catch(() => ({})), response.status, "guía de remisión");
    } catch (error) {
      if (error instanceof Error && error.message.includes("credencial")) throw error;
      return { providerCode: this.code, status: "PENDING", message: `Resultado incierto con APIsPERU: ${error instanceof Error ? error.message : "sin respuesta"}.` };
    }
  }

  async getDespatchStatus(_command: DespatchCommand, ticket?: string): Promise<DespatchResult> {
    if (!ticket) return { providerCode: this.code, status: "PENDING", message: "La guía aún no tiene ticket de SUNAT." };
    const url = new URL("despatch/status", this.baseUrl);
    url.searchParams.set("ticket", ticket);
    url.searchParams.set("ruc", this.options.issuer.ruc);
    try {
      const response = await this.request(url, { method: "GET" });
      return interpretTicketStatus<DespatchResult>(await response.json().catch(() => ({})) as ApiPeruStatusResponse, ticket);
    } catch (error) {
      return { providerCode: this.code, status: "PENDING", ticket, message: `No pudimos consultar la guía: ${error instanceof Error ? error.message : "sin respuesta"}` };
    }
  }

  /** PDF oficial de la guía (despatch/pdf). */
  async getDespatchPdf(command: DespatchCommand): Promise<Buffer> {
    const response = await this.request(new URL("despatch/pdf", this.baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/pdf" },
      body: JSON.stringify(mapDespatchToApiPeru(command, this.options.issuer))
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!response.ok || bytes.subarray(0, 4).toString("ascii") !== "%PDF") throw new Error(`APIsPERU no generó el PDF de la guía (HTTP ${response.status}).`);
    return bytes;
  }

  private async request(url: URL, init: RequestInit) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.options.token}`,
          ...(init.headers ?? {})
        }
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}
