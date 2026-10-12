export type DocumentType = "BOLETA" | "FACTURA";
export type ReceiptStatus = "PENDING" | "SYNCING" | "ACCEPTED" | "ERROR";
export type CustomerDocumentType = "DNI" | "RUC";

export type Product = {
  id: string;
  name: string;
  unitPrice: number;
  unit?: string;
  favorite?: boolean;
};

export type SaleItem = Product & {
  quantity: number;
};

export type Customer = {
  documentType?: CustomerDocumentType;
  documentNumber?: string;
  name?: string;
  address?: string;
  phone?: string;
  email?: string;
};

export type SaleDraft = {
  items: SaleItem[];
  documentType: DocumentType;
  customer?: Customer;
};

export type PendingReceipt = {
  clientTransactionId: string;
  temporaryNumber: string;
  createdAt: string;
  documentType: DocumentType;
  items: SaleItem[];
  customer?: Customer;
  total: number;
  status: ReceiptStatus;
  errorMessage?: string;
  officialNumber?: string;
};

export type BusinessProfile = {
  phone?: string;
  ruc?: string;
  businessName?: string;
  tradeName?: string;
  address?: string;
  taxpayerStatus?: string;
  sunatUser?: string;
  onboardingComplete: boolean;
};
