import http from "node:http";

const port = Number(process.env.PORT ?? 4100);
const expectedToken = process.env.MOCK_DOCUMENT_TOKEN ?? "e2e-token";
const stats = { dni: 0, ruc: 0, nubefactIssued: 0, nubefactQueries: 0, apisperuIssued: 0, apisperuPdfs: 0 };
const apisperuToken = process.env.MOCK_APISPERU_TOKEN ?? "e2e-apisperu-token";
const apisperuDocs = new Map();

/**
 * Simulador de APIsPERU (OpenAPI oficial): Bearer token de la empresa,
 * invoice/send y note/send devuelven DocumentResponse; los errores de
 * validación son una lista { field, message }; invoice/status consulta el CDR.
 */
function apisperu(path, body, query) {
  if (path === "/invoice/status") {
    const doc = apisperuDocs.get(`${query.get("tipo")}-${query.get("serie")}-${query.get("numero")}`);
    return doc ? [200, { success: true, cdrZip: "CDR", cdrResponse: doc.cdrResponse }] : [200, { success: false, error: { code: "0127", message: "No existe" } }];
  }
  const isPdf = path.endsWith("/pdf");
  const details = Array.isArray(body.details) ? body.details : [];
  const sum = (field) => details.reduce((total, item) => total + cents(item[field]), 0);
  const errors = [];
  if (!body.company?.ruc) errors.push({ field: "company.ruc", message: "requerido" });
  if (!details.length) errors.push({ field: "details", message: "requerido" });
  if (sum("mtoValorVenta") !== cents(body.mtoOperGravadas)) errors.push({ field: "mtoOperGravadas", message: "no coincide con el detalle" });
  if (sum("igv") !== cents(body.mtoIGV)) errors.push({ field: "mtoIGV", message: "no coincide con el detalle" });
  if (path.startsWith("/note/") && (!body.tipDocAfectado || !body.numDocfectado || !body.codMotivo)) errors.push({ field: "numDocfectado", message: "requerido" });
  if (errors.length) return [400, errors];
  if (isPdf) {
    stats.apisperuPdfs += 1;
    return [200, Buffer.from(`%PDF-1.4\n% APISPERU-PDF ${body.serie}-${body.correlativo} QR+HASH\n%%EOF\n`), "application/pdf"];
  }
  const key = `${body.tipoDoc}-${body.serie}-${body.correlativo}`;
  if (apisperuDocs.has(key)) return [200, { xml: "", hash: "", sunatResponse: { success: false, error: { code: "1033", message: "El comprobante fue registrado previamente con otros datos" } } }];
  stats.apisperuIssued += 1;
  const cdrResponse = { accepted: true, id: `${body.serie}-${body.correlativo}`, code: "0", description: `El comprobante ${body.serie}-${body.correlativo} ha sido aceptado`, notes: [] };
  apisperuDocs.set(key, { cdrResponse });
  return [200, { xml: "<Invoice/>", hash: `hash-${key}`, sunatResponse: { success: true, cdrZip: "CDR", cdrResponse } }];
}
const nubefactToken = process.env.MOCK_NUBEFACT_TOKEN ?? "e2e-nubefact-token";
const nubefactDocs = new Map();
const cents = (value) => Math.round(Number(value) * 100);

/**
 * Simulador del API JSON de Nubefact (manual oficial): POST a la ruta con
 * `Authorization: <token>`. Valida que las líneas cuadren con los totales,
 * responde código 23 si el documento ya existe y 24 si no existe.
 */
function nubefact(body) {
  const key = `${body.tipo_de_comprobante}-${body.serie}-${body.numero}`;
  if (body.operacion === "consultar_comprobante") {
    stats.nubefactQueries += 1;
    const doc = nubefactDocs.get(key);
    return doc ? [200, doc] : [400, { errors: "El documento indicado no existe o no fue enviado a NubeFacT", codigo: 24 }];
  }
  if (body.operacion !== "generar_comprobante") return [400, { errors: "Operación no soportada", codigo: 20 }];
  if (nubefactDocs.has(key)) return [400, { errors: "Este documento ya existe en NubeFacT", codigo: 23 }];
  const items = Array.isArray(body.items) ? body.items : [];
  const sum = (field) => items.reduce((total, item) => total + cents(item[field]), 0);
  if (!items.length || sum("subtotal") !== cents(body.total_gravada) || sum("igv") !== cents(body.total_igv) || sum("total") !== cents(body.total)) {
    return [400, { errors: "La suma de las líneas no coincide con los totales", codigo: 20 }];
  }
  if (!/^[FB]/.test(String(body.serie)) || String(body.serie).length !== 4) return [400, { errors: "Serie inválida", codigo: 20 }];
  if (body.tipo_de_comprobante === 1 && (body.cliente_tipo_de_documento !== "6" || !body.cliente_direccion)) {
    return [400, { errors: "La factura requiere RUC y dirección del cliente", codigo: 20 }];
  }
  if (body.tipo_de_comprobante === 3 && !body.documento_que_se_modifica_serie) {
    return [400, { errors: "La nota de crédito requiere el documento que modifica", codigo: 20 }];
  }
  stats.nubefactIssued += 1;
  const id = `${body.serie}-${body.numero}-${Date.now()}`;
  const doc = {
    tipo_de_comprobante: body.tipo_de_comprobante,
    serie: body.serie,
    numero: body.numero,
    enlace: `https://www.nubefact.com/cpe/${id}`,
    enlace_del_pdf: `https://www.nubefact.com/cpe/${id}.pdf`,
    enlace_del_xml: `https://www.nubefact.com/cpe/${id}.xml`,
    enlace_del_cdr: `https://www.nubefact.com/cpe/${id}.cdr`,
    aceptada_por_sunat: true,
    sunat_description: `El comprobante ${body.serie}-${body.numero} ha sido aceptado`,
    sunat_note: null,
    sunat_responsecode: "0",
    sunat_soap_error: "",
    cadena_para_codigo_qr: `20000000001 | ${body.serie} | ${body.numero} | ${body.total_igv} | ${body.total}`,
    codigo_hash: `hash-${id}`
  };
  nubefactDocs.set(key, doc);
  return [200, doc];
}

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (error) { reject(error); }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    return send(res, 200, { ok: true });
  }
  if (req.method === "GET" && req.url === "/stats") {
    return send(res, 200, stats);
  }
  if (req.method === "POST" && req.url === "/reset") {
    stats.dni = 0;
    stats.ruc = 0;
    stats.nubefactIssued = 0;
    stats.nubefactQueries = 0;
    stats.apisperuIssued = 0;
    stats.apisperuPdfs = 0;
    nubefactDocs.clear();
    apisperuDocs.clear();
    return send(res, 200, { ok: true });
  }

  if (req.url?.startsWith("/apisperu/")) {
    if (req.headers.authorization !== `Bearer ${apisperuToken}`) return send(res, 401, { message: "Unauthorized" });
    const url = new URL(req.url, "http://localhost");
    try {
      const body = req.method === "POST" ? await readJson(req) : {};
      const [status, payload, contentType] = apisperu(url.pathname.replace(/^\/apisperu/, ""), body, url.searchParams);
      if (contentType) {
        res.writeHead(status, { "content-type": contentType, "content-length": payload.length });
        return res.end(payload);
      }
      return send(res, status, payload);
    } catch {
      return send(res, 400, [{ field: "body", message: "JSON inválido" }]);
    }
  }

  if (req.method === "POST" && req.url === "/nubefact") {
    if (req.headers.authorization !== nubefactToken) return send(res, 401, { errors: "No se pudo autenticar, token incorrecto o eliminado", codigo: 10 });
    try {
      const [status, payload] = nubefact(await readJson(req));
      return send(res, status, payload);
    } catch {
      return send(res, 400, { errors: "El archivo enviado no cumple con el formato establecido", codigo: 20 });
    }
  }

  if (req.headers.authorization !== `Bearer ${expectedToken}`) {
    return send(res, 401, { success: false, message: "invalid token" });
  }

  try {
    const body = await readJson(req);
    if (req.method === "POST" && req.url === "/dni") {
      stats.dni += 1;
      if (body.dni === "12345678") {
        return send(res, 200, {
          success: true,
          data: {
            numero: "12345678",
            nombres: "ANA MARIA",
            apellido_paterno: "PRUEBA",
            apellido_materno: "E2E"
          }
        });
      }
      return send(res, 404, { success: false, code: "document_not_found", message: "not found" });
    }

    if (req.method === "POST" && req.url === "/ruc") {
      stats.ruc += 1;
      return send(res, 404, { success: false, code: "document_not_found", message: "not found" });
    }

    return send(res, 404, { success: false, message: "route not found" });
  } catch {
    return send(res, 400, { success: false, message: "invalid json" });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`mock document api listening on ${port}`);
});
