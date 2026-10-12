import { createHmac, timingSafeEqual } from "node:crypto";

export type ReceiptLinkPurpose = "VIEW" | "PDF" | "GUIDE_PDF";

type ReceiptLinkPayload = {
  receiptId: string;
  tenantId: string;
  purpose: ReceiptLinkPurpose;
  exp: number;
};

function getSecret() {
  const configured = process.env.PUBLIC_RECEIPT_LINK_SECRET?.trim();
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error("PUBLIC_RECEIPT_LINK_SECRET es obligatorio en producción");
  }
  return "dev-public-receipt-link-secret-change-me";
}

function encode(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

function sign(encodedPayload: string) {
  return createHmac("sha256", getSecret()).update(encodedPayload).digest("base64url");
}

export function receiptLinkTtlSeconds() {
  const configured = Number(process.env.PUBLIC_RECEIPT_LINK_TTL_SECONDS ?? 2_592_000);
  if (!Number.isFinite(configured)) return 2_592_000;
  return Math.min(Math.max(Math.trunc(configured), 300), 31_536_000);
}

export function createReceiptLinkToken(input: {
  receiptId: string;
  tenantId: string;
  purpose: ReceiptLinkPurpose;
  expiresAt?: Date;
}) {
  const expiresAt = input.expiresAt ?? new Date(Date.now() + receiptLinkTtlSeconds() * 1000);
  const payload: ReceiptLinkPayload = {
    receiptId: input.receiptId,
    tenantId: input.tenantId,
    purpose: input.purpose,
    exp: Math.floor(expiresAt.getTime() / 1000)
  };
  const encodedPayload = encode(JSON.stringify(payload));
  return {
    token: `${encodedPayload}.${sign(encodedPayload)}`,
    expiresAt
  };
}

export function verifyReceiptLinkToken(token: string, expectedPurpose: ReceiptLinkPurpose): ReceiptLinkPayload {
  const [encodedPayload, signature, extra] = token.split(".");
  if (!encodedPayload || !signature || extra) throw new Error("Enlace inválido");

  const expected = sign(encodedPayload);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw new Error("Enlace inválido");
  }

  let payload: ReceiptLinkPayload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as ReceiptLinkPayload;
  } catch {
    throw new Error("Enlace inválido");
  }

  if (!payload.receiptId || !payload.tenantId || payload.purpose !== expectedPurpose || !Number.isFinite(payload.exp)) {
    throw new Error("Enlace inválido");
  }
  if (payload.exp <= Math.floor(Date.now() / 1000)) throw new Error("Este enlace venció");
  return payload;
}

export function publicBaseUrl() {
  const configured = process.env.PUBLIC_APP_BASE_URL?.trim().replace(/\/$/, "");
  if (configured) return configured;
  const port = Number(process.env.API_PORT ?? 4000);
  return `http://localhost:${port}`;
}
