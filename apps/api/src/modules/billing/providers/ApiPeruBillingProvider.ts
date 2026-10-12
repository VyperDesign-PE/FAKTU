import type { BillingProvider } from "../BillingProvider.js";
import type {
  BillingIssueResult,
  BillingIssuer,
  IssueDocumentCommand,
  ProviderHealth
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

const SUNAT_DOC_TYPE = { FACTURA: "01", BOLETA: "03", NOTA_CREDITO: "07" } as const;

export function mapCommandToApiPeru(command: IssueDocumentCommand, issuer: BillingIssuer) {
  if (!/^\d{11}$/.test(issuer.ruc)) throw new Error("El negocio debe tener un RUC valido antes de emitir.");
  if (!issuer.legalName?.trim()) throw new Error("El negocio debe tener razon social antes de emitir.");
  if (command.documentType === "FACTURA" && command.customer?.documentType !== "RUC") {
    throw new Error("Para emitir una factura el cliente debe tener RUC.");
  }
  if (command.documentType === "NOTA_CREDITO" && (!command.relatedDocument || !command.creditNoteReason)) {
    throw new Error("La nota de crédito debe indicar el comprobante que modifica y el motivo.");
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
    tipoOperacion: "0101",
    tipoDoc: SUNAT_DOC_TYPE[command.documentType],
    serie: command.series,
    correlativo: String(command.correlative),
    fechaEmision: formatLimaIso(command.issueDate),
    ...(command.documentType === "NOTA_CREDITO"
      ? {
          tipDocAfectado: SUNAT_DOC_TYPE[command.relatedDocument!.documentType],
          numDocfectado: `${command.relatedDocument!.series}-${command.relatedDocument!.correlative}`,
          codMotivo: command.creditNoteReason!.code,
          desMotivo: command.creditNoteReason!.description
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

function messageFromResponse(payload: ApiPeruSendResponse | ApiPeruStatusResponse, fallback: string) {
  const cdr = "cdrResponse" in payload
    ? payload.cdrResponse
    : "sunatResponse" in payload
      ? payload.sunatResponse?.cdrResponse
      : undefined;
  const error = payload.error ?? ("sunatResponse" in payload ? payload.sunatResponse?.error : undefined);
  return cdr?.description || error?.message || ("message" in payload ? payload.message : undefined) || fallback;
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
      const path = command.documentType === "NOTA_CREDITO" ? "note/send" : "invoice/send";
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

    const payload = await response.json().catch(() => ({})) as ApiPeruSendResponse;
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
    const accepted = sunat?.success === true && cdr?.accepted === true;
    const rejected = sunat?.success === false || cdr?.accepted === false;
    return {
      providerCode: this.code,
      status: accepted ? "ACCEPTED" : rejected ? "REJECTED" : "PENDING",
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
      const accepted = payload.success === true && cdr?.accepted === true;
      const rejected = payload.success === false || cdr?.accepted === false;
      return {
        providerCode: this.code,
        status: accepted ? "ACCEPTED" : rejected ? "REJECTED" : "PENDING",
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
