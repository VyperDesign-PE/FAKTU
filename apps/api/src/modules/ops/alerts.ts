import { sql } from "../../db/client.js";

/**
 * Alertas operativas a un webhook (Slack, Discord, Google Chat, Telegram vía bot…):
 * ALERT_WEBHOOK_URL. Se envía como { text, content } para ser compatible con
 * Slack y Discord. Cada tipo de alerta se repite como máximo una vez por hora.
 */
const lastSent = new Map<string, number>();
const THROTTLE_MS = 60 * 60 * 1000;

export async function sendAlert(key: string, text: string) {
  const url = process.env.ALERT_WEBHOOK_URL?.trim();
  if (!url) return false;
  const now = Date.now();
  if ((lastSent.get(key) ?? 0) > now - THROTTLE_MS) return false;
  lastSent.set(key, now);
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: `[Faktu] ${text}`, content: `[Faktu] ${text}` }),
      signal: AbortSignal.timeout(10_000)
    });
    return true;
  } catch {
    return false;
  }
}

/** Documentos reales (no de práctica) que llevan más de 30 minutos sin respuesta final. */
export async function stuckDocuments() {
  const [row] = await sql<{ receipts: string; voidings: string; guides: string }[]>`
    select
      (select count(*) from receipts where is_practice = false and sunat_status in ('PENDIENTE', 'ENVIANDO', 'ERROR', 'OBSERVADO') and created_at < now() - interval '30 minutes') as receipts,
      (select count(*) from receipt_voidings where is_practice = false and status in ('PENDIENTE', 'ENVIANDO', 'ERROR') and created_at < now() - interval '30 minutes') as voidings,
      (select count(*) from despatch_guides where is_practice = false and status in ('PENDIENTE', 'ENVIANDO', 'ERROR') and created_at < now() - interval '30 minutes') as guides
  `;
  return { receipts: Number(row.receipts), voidings: Number(row.voidings), guides: Number(row.guides) };
}

export async function checkAndAlertStuckDocuments() {
  const stuck = await stuckDocuments();
  const total = stuck.receipts + stuck.voidings + stuck.guides;
  if (total > 0) {
    await sendAlert("stuck", `${total} documento(s) llevan más de 30 min sin respuesta de SUNAT/proveedor (comprobantes ${stuck.receipts}, bajas ${stuck.voidings}, guías ${stuck.guides}). Revisa el proveedor.`);
  }
  return stuck;
}
