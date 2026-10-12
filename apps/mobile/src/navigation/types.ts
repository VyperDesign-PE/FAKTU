import type { RemoteCustomer } from "../services/api";

export type RootStackParamList = {
  Login: undefined;
  Register: undefined;

  Welcome: undefined;
  VerifyPhone: undefined;
  OtpCode: { phone: string } | undefined;
  EnterRuc: undefined;
  ConfirmBusiness: { ruc: string };
  SunatConnectionData: undefined;
  AuthorizePse: undefined;
  Authorizing: undefined;
  EnabledDocuments: undefined;
  Ready: undefined;

  Dashboard: undefined;
  POSVenta: undefined;
  HistorialComprobantes: undefined;
  Configuracion: undefined;

  Home: undefined;
  NewSale: undefined;
  AddProduct: undefined;
  QuickSale: undefined;
  Cart: undefined;
  DocumentType: undefined;
  CustomerData: undefined;
  SaleSummary: undefined;
  EmissionResult: undefined;
  ShareReceipt: { clientTransactionId?: string } | undefined;

  OfflineHome: undefined;
  OfflineSale: undefined;
  TemporaryReceipt: undefined;
  PendingReceipts: undefined;
  Syncing: undefined;
  SyncResult: { accepted: number; errors: number } | undefined;

  Catalog: undefined;
  Customers: undefined;
  CustomerForm: { customer?: RemoteCustomer } | undefined;
  ReceiptHistory: undefined;
  ReceiptDetail: { clientTransactionId: string };
  CashClose: undefined;
  BillingSettings: undefined;
  SystemStatus: undefined;
  Business: undefined;
  Support: undefined;
};
