import { getBusiness } from "../tenants/tenantRepository.js";
import { getReceiptById } from "../receipts/receiptRepository.js";
import { createReceiptSharePackage } from "../sharing/receiptSharingService.js";
import { claimPendingDeliveries, markDeliveryFailed, markDeliverySent } from "./deliveryRepository.js";

export class DeliveryService {
  async processPending(tenantId: string, limit = 20) {
    const jobs = await claimPendingDeliveries(tenantId, limit);
    const results = [];
    for (const job of jobs) {
      try {
        const [receipt, business] = await Promise.all([getReceiptById(tenantId, job.receiptId), getBusiness(tenantId)]);
        if (!receipt || !business) throw new Error("No encontramos el comprobante o el negocio.");
        if (receipt.status !== "ACEPTADO") throw new Error("El comprobante todavía no está aceptado.");
        const pack = createReceiptSharePackage(receipt, business);

        const provider = (process.env.DELIVERY_PROVIDER ?? "disabled").toLowerCase();
        if (provider === "mock") {
          results.push(await markDeliverySent(tenantId, job.id, "mock", `mock-${job.id.slice(0, 8)}`));
          continue;
        }

        // Seguridad: no fingimos un envío real. WhatsApp Business/SMS/Email se habilitan
        // únicamente cuando exista un adaptador servidor-a-servidor con credenciales seguras.
        const detail = job.channel === "WHATSAPP" ? pack.whatsappText : job.channel === "EMAIL" ? pack.emailBody : pack.viewUrl;
        throw new Error(`Canal ${job.channel} todavía no tiene proveedor automático configurado. Contenido preparado: ${detail.slice(0, 80)}…`);
      } catch (error) {
        results.push(await markDeliveryFailed(tenantId, job.id, error instanceof Error ? error.message : "Error de entrega"));
      }
    }
    return results.filter(Boolean);
  }
}
