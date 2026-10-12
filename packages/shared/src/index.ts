export type DocumentType = "BOLETA" | "FACTURA";
export type ReceiptStatus = "PENDING" | "SYNCING" | "ACCEPTED" | "ERROR";

export type SaleItem = {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
};

export type Customer = {
  documentType?: "DNI" | "RUC";
  documentNumber?: string;
  name?: string;
};

export type PendingReceipt = {
  clientTransactionId: string;
  temporaryNumber: string;
  createdAt: string;
  documentType: DocumentType;
  customer?: Customer;
  items: SaleItem[];
  total: number;
  status: ReceiptStatus;
  errorMessage?: string;
  officialNumber?: string;
};
