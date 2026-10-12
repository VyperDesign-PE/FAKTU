import http from "node:http";

const port = Number(process.env.PORT ?? 4100);
const expectedToken = process.env.MOCK_DOCUMENT_TOKEN ?? "e2e-token";
const stats = { dni: 0, ruc: 0 };

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
    return send(res, 200, { ok: true });
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
