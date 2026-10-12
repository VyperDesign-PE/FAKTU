import type { BillingDocumentType } from "../billing/contracts.js";

/** SUNAT exige identificar al adquirente en boletas cuyo importe supera este monto. */
export const BOLETA_IDENTIFICATION_THRESHOLD_PEN = 700;

export type DocumentRuleCustomer = {
  documentType?: "DNI" | "RUC";
  documentNumber?: string;
  name?: string;
};

export class DocumentRuleError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "DocumentRuleError";
  }
}

const RUC_PATTERN = /^(10|15|16|17|20)\d{9}$/;
const DNI_PATTERN = /^\d{8}$/;

/**
 * Reglas tributarias que se validan ANTES de reservar un correlativo, para no
 * consumir números con ventas que el proveedor rechazaría de todas formas.
 */
export function assertDocumentRules(input: {
  documentType: BillingDocumentType;
  total: number;
  customer?: DocumentRuleCustomer;
}) {
  const customer = input.customer;
  const documentNumber = customer?.documentNumber?.trim();

  if (documentNumber) {
    if (customer?.documentType === "RUC" && !RUC_PATTERN.test(documentNumber)) {
      throw new DocumentRuleError("INVALID_RUC", "El RUC del cliente no es válido.");
    }
    if (customer?.documentType === "DNI" && !DNI_PATTERN.test(documentNumber)) {
      throw new DocumentRuleError("INVALID_DNI", "El DNI del cliente debe tener 8 dígitos.");
    }
    if (!customer?.documentType) {
      throw new DocumentRuleError("MISSING_DOCUMENT_TYPE", "Indica si el documento del cliente es DNI o RUC.");
    }
  }

  if (input.documentType === "FACTURA") {
    if (customer?.documentType !== "RUC" || !documentNumber) {
      throw new DocumentRuleError("FACTURA_REQUIRES_RUC", "Para emitir una factura el cliente debe tener RUC.");
    }
    if (!customer.name?.trim()) {
      throw new DocumentRuleError("FACTURA_REQUIRES_NAME", "Para emitir una factura indica la razón social del cliente.");
    }
  }

  if (input.documentType === "BOLETA" && input.total > BOLETA_IDENTIFICATION_THRESHOLD_PEN) {
    if (!documentNumber || !customer?.name?.trim()) {
      throw new DocumentRuleError(
        "BOLETA_REQUIRES_CUSTOMER",
        `Las boletas mayores a S/ ${BOLETA_IDENTIFICATION_THRESHOLD_PEN} deben identificar al cliente (DNI o RUC y nombre).`
      );
    }
  }
}
