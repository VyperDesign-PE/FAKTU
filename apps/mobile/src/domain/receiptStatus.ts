/**
 * Una sola traducción de estados técnicos a texto, tono y descripción.
 * - Local: el comprobante vive en la cola de este dispositivo (`PendingReceipt.status`).
 * - Remoto: el servidor ya lo conoce (`RemoteReceipt.status`; el detalle fino está en `sunatStatus`).
 * ERROR nunca equivale a RECHAZADO: un error se reintenta; un rechazo es una respuesta final.
 */
export type StatusTone = "success" | "warning" | "danger" | "muted";
export type StatusInfo = { label: string; tone: StatusTone; description: string };
type Gender = "m" | "f";

const LOCAL: Record<"PENDING" | "SYNCING" | "ACCEPTED" | "REJECTED" | "ERROR", { m: string; f: string; tone: StatusTone; description: string }> = {
  PENDING: { m: "Guardado, falta enviar", f: "Guardada, falta enviar", tone: "warning", description: "Está guardado en este dispositivo y se enviará cuando haya conexión." },
  SYNCING: { m: "Enviando", f: "Enviando", tone: "warning", description: "Se está enviando ahora." },
  ACCEPTED: { m: "Aceptado", f: "Aceptada", tone: "success", description: "El proveedor confirmó el comprobante." },
  REJECTED: { m: "Rechazado", f: "Rechazada", tone: "danger", description: "No se aceptó. Revisa el motivo y registra la venta de nuevo." },
  ERROR: { m: "Error al enviar", f: "Error al enviar", tone: "danger", description: "No se pudo enviar. Se reintentará; tus datos siguen guardados." }
};

const REMOTE: Record<"PENDING" | "ACCEPTED" | "REJECTED" | "ERROR", { m: string; f: string; tone: StatusTone; description: string }> = {
  PENDING: { m: "En proceso", f: "En proceso", tone: "warning", description: "Todavía no hay respuesta final de SUNAT." },
  ACCEPTED: LOCAL.ACCEPTED,
  REJECTED: LOCAL.REJECTED,
  ERROR: { m: "Requiere revisión", f: "Requiere revisión", tone: "danger", description: "Hubo un problema al procesarlo. Se reintenta solo, pero conviene revisarlo." }
};

export function localStatusInfo(status: keyof typeof LOCAL, gender: Gender = "m"): StatusInfo {
  const info = LOCAL[status];
  return { label: info[gender], tone: info.tone, description: info.description };
}

export function remoteStatusInfo(status: keyof typeof REMOTE, gender: Gender = "m"): StatusInfo {
  const info = REMOTE[status];
  return { label: info[gender], tone: info.tone, description: info.description };
}
