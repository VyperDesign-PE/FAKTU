import type { BillingProvider } from "../BillingProvider.js";
import type {
  BillingIssueResult,
  BillingIssuer,
  IssueDocumentCommand,
  ProviderHealth
} from "../contracts.js";
import { amountInWordsPen } from "../amountInWords.js";

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

function round(value: number, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

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

export function mapCommandToApiPeru(command: IssueDocumentCommand, issuer: BillingIssuer) {
  if (!/^\d{11}$/.test(issuer.ruc)) throw new Error("El negocio debe tener un RUC valido antes de emitir.");
  if (!issuer.legalName?.trim()) throw new Error("El negocio debe tener razon social antes de emitir.");
  if (command.documentType === "FACTURA" && command.customer?.documentType !== "RUC") {
    throw new Error("Para emitir una factura el cliente debe tener RUC.");
  }

  const details = command.items.map((item) => {
    const quantity = round(item.quantity, 4);
    const grossUnit = round(item.unitPrice, 6);
    const netUnit = round(grossUnit / 1.18, 6);
    const base = round(netUnit * quantity, 2);
    const igv = round(base * 0.18, 2);
    return {
      ...(item.sku ? { codProducto: item.sku } : {}),
      unidad: item.unitCode || "NIU",
      descripcion: item.description,
      cantidad: quantity,
      mtoValorUnitario: netUnit,
      mtoValorVenta: base,
      mtoBaseIgv: base,
      porcentajeIgv: 18,
      igv,
      tipAfeIgv: 10,
      totalImpuestos: igv,
      mtoPrecioUnitario: grossUnit
    };
  });

  return {
    ublVersion: "2.1",
    tipoOperacion: "0101",
    tipoDoc: command.documentType === "FACTURA" ? "01" : "03",
    serie: command.series,
    correlativo: String(command.correlative),
    fechaEmision: formatLimaIso(command.issueDate),
    formaPago: { moneda: command.currency, tipo: "Contado" },
    tipoMoneda: command.currency,
    client: customerPayload(command),
    company: companyPayload(issuer),
    mtoOperGravadas: round(command.subtotal, 2),
    mtoIGV: round(command.igv, 2),
    valorVenta: round(command.subtotal, 2),
    totalImpuestos: round(command.igv, 2),
    subTotal: round(command.total, 2),
    mtoImpVenta: round(command.total, 2),
    details,
    legends: [{ code: "1000", value: amountInWordsPen(command.total) }]
  };
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
      response = await this.request(new URL("invoice/send", this.baseUrl), {
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
    url.searchParams.set("tipo", command.documentType === "FACTURA" ? "01" : "03");
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
