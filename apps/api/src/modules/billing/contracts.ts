export type BillingProviderCode = "mock" | "apisperu" | "nubefact" | "efact" | "senda" | "facturadorpe" | "cpeapi" | "external";
export type BillingEnvironment = "sandbox" | "production";
export type BillingDocumentType = "BOLETA" | "FACTURA";

export type BillingAddress = {
  address?: string;
  ubigeo?: string;
  department?: string;
  province?: string;
  district?: string;
};

export type BillingIssuer = {
  ruc: string;
  legalName: string;
  tradeName?: string;
  address?: BillingAddress;
};

export type BillingCustomer = {
  documentType?: "DNI" | "RUC";
  documentNumber?: string;
  name?: string;
  address?: string;
};

export type BillingItem = {
  sku?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  unitCode?: string;
};

export type IssueDocumentCommand = {
  tenantId: string;
  clientTransactionId: string;
  documentType: BillingDocumentType;
  series: string;
  correlative: number;
  currency: "PEN";
  issueDate: string;
  issuer?: BillingIssuer;
  customer?: BillingCustomer;
  items: BillingItem[];
  subtotal: number;
  igv: number;
  total: number;
};

export type BillingProviderArtifacts = {
  hash?: string;
  xmlContent?: string;
  cdrZipBase64?: string;
  rawResponse?: unknown;
};

export type BillingIssueResult = {
  providerCode: BillingProviderCode;
  status: "ACCEPTED" | "REJECTED" | "PENDING";
  officialNumber?: string;
  providerDocumentId?: string;
  message: string;
  pdfUrl?: string;
  xmlUrl?: string;
  cdrUrl?: string;
  artifacts?: BillingProviderArtifacts;
};

export type ProviderHealth = "UP" | "DOWN" | "DEGRADED";

export type TenantBillingConfig = {
  tenantId: string;
  providerCode: BillingProviderCode;
  environment: BillingEnvironment;
  providerAccountRef?: string;
  credentialSecretRef?: string;
};
