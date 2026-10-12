import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import NetInfo from "@react-native-community/netinfo";
import type { BusinessProfile, Customer, DocumentType, PaymentMethod, PendingReceipt, Product, SaleDraft } from "../domain/types";
import { enqueueReceipt, getQueue } from "../storage/receiptQueue";
import { syncPendingReceipts } from "../services/sync";
import { loadProfile, saveProfile } from "../storage/profile";
import { loadCatalog, saveCatalog } from "../storage/catalog";
import { listCachedCustomers } from "../storage/customerCache";
import { useAuth } from "./AuthContext";
import {
  getRemoteBusiness,
  listRemoteProducts,
  listRemoteReceipts,
  type RemoteReceipt,
  updateRemoteBusiness,
  upsertRemoteProduct,
  saveRemoteCustomer
} from "../services/api";

const initialDraft: SaleDraft = { items: [], documentType: "BOLETA", paymentMethod: "EFECTIVO" };

type AppContextValue = {
  hydrated: boolean;
  online: boolean;
  queue: PendingReceipt[];
  history: RemoteReceipt[];
  pendingCount: number;
  profile: BusinessProfile;
  catalog: Product[];
  draft: SaleDraft;
  lastReceipt?: PendingReceipt;
  setProfilePatch: (patch: Partial<BusinessProfile>, options?: { strict?: boolean }) => Promise<void>;
  completeOnboarding: () => Promise<void>;
  addProductToCatalog: (product: Product) => Promise<void>;
  addItem: (product: Product) => void;
  setItemQuantity: (id: string, quantity: number) => void;
  removeItem: (id: string) => void;
  setDocumentType: (type: DocumentType) => void;
  setCustomer: (customer?: Customer) => void;
  setPayment: (paymentMethod: PaymentMethod, amountReceived?: number) => void;
  resetDraft: () => void;
  createReceipt: () => Promise<PendingReceipt>;
  refreshQueue: () => Promise<void>;
  refreshHistory: () => Promise<void>;
  syncNow: () => Promise<{ accepted: number; errors: number }>;
};

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const { user, hydrated: authHydrated } = useAuth();
  const scope = user?.tenantId ?? user?.id ?? "anonymous";
  const [hydrated, setHydrated] = useState(false);
  const [online, setOnline] = useState(true);
  const [queue, setQueue] = useState<PendingReceipt[]>([]);
  const [history, setHistory] = useState<RemoteReceipt[]>([]);
  const [profile, setProfile] = useState<BusinessProfile>({ onboardingComplete: false });
  const [catalog, setCatalog] = useState<Product[]>([]);
  const [draft, setDraft] = useState<SaleDraft>(initialDraft);
  const [lastReceipt, setLastReceipt] = useState<PendingReceipt>();

  const refreshQueue = useCallback(async () => setQueue(await getQueue(scope)), [scope]);

  const syncCachedCustomers = useCallback(async () => {
    if (!user) return;
    const cached = await listCachedCustomers(scope);
    await Promise.all(cached.map((customer) => saveRemoteCustomer({
      documentType: customer.documentType,
      documentNumber: customer.documentNumber,
      fullName: customer.name,
      address: customer.address,
      phone: customer.phone,
      email: customer.email
    }).catch(() => undefined)));
  }, [scope, user]);

  const refreshHistory = useCallback(async () => {
    if (!user) {
      setHistory([]);
      return;
    }
    try {
      setHistory(await listRemoteReceipts(150));
    } catch {
      // La UI sigue operativa con la cola local cuando no hay conexión.
    }
  }, [user]);

  const syncNow = useCallback(async () => {
    if (!user) return { accepted: 0, errors: 0 };
    await syncPendingReceipts(scope);
    const next = await getQueue(scope);
    setQueue(next);
    await refreshHistory();
    return {
      accepted: next.filter((r) => r.status === "ACCEPTED").length,
      errors: next.filter((r) => r.status === "ERROR" || r.status === "REJECTED").length
    };
  }, [refreshHistory, scope, user]);

  useEffect(() => {
    if (!authHydrated) return;
    let active = true;
    setHydrated(false);

    Promise.all([loadProfile(scope), loadCatalog(scope), getQueue(scope)]).then(async ([localProfile, localCatalog, localQueue]) => {
      if (!active) return;
      setProfile(localProfile);
      setCatalog(localCatalog);
      setQueue(localQueue);
      setDraft(initialDraft);
      setLastReceipt(undefined);

      if (user) {
        try {
          // Subimos el catálogo local primero: así productos creados offline sobreviven al cambio de dispositivo.
          await Promise.all(localCatalog.map((product) => upsertRemoteProduct(product)));
          await syncCachedCustomers();
          const [remoteProfile, remoteCatalog, remoteHistory] = await Promise.all([
            getRemoteBusiness(),
            listRemoteProducts(),
            listRemoteReceipts(150)
          ]);
          if (!active) return;

          const mergedProfile = { ...localProfile, ...remoteProfile };
          setProfile(mergedProfile);
          await saveProfile(scope, mergedProfile);

          if (remoteCatalog.length) {
            setCatalog(remoteCatalog);
            await saveCatalog(scope, remoteCatalog);
          }
          setHistory(remoteHistory);
        } catch {
          // Offline-first: conservamos perfil, catálogo y cola locales.
        }
      }

      if (active) setHydrated(true);
    });

    const unsubscribe = NetInfo.addEventListener(async (state) => {
      const connected = Boolean(state.isConnected && state.isInternetReachable !== false);
      setOnline(connected);
      if (connected && user) {
        // Sincroniza también cambios hechos offline en perfil y catálogo antes de procesar comprobantes.
        try {
          const [savedProfile, savedCatalog] = await Promise.all([loadProfile(scope), loadCatalog(scope)]);
          await Promise.all(savedCatalog.map((product) => upsertRemoteProduct(product)));
          await updateRemoteBusiness(savedProfile);
          await syncCachedCustomers();
        } catch {
          // La cola de comprobantes seguirá intentando; no bloqueamos la venta por un fallo de configuración.
        }
        await syncNow();
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [authHydrated, scope, syncCachedCustomers, syncNow, user]);

  /**
   * Guarda datos del negocio. Con `strict`, un rechazo del servidor (por
   * ejemplo, RUC ya registrado) se propaga y no se guarda localmente.
   */
  async function setProfilePatch(patch: Partial<BusinessProfile>, options: { strict?: boolean } = {}) {
    const next = { ...profile, ...patch };
    if (options.strict && online && user) await updateRemoteBusiness(next);
    setProfile(next);
    await saveProfile(scope, next);
    if (!options.strict && online && user) {
      await updateRemoteBusiness(next).catch(() => undefined);
    }
  }

  async function completeOnboarding() {
    await setProfilePatch({ onboardingComplete: true });
  }

  async function addProductToCatalog(product: Product) {
    const next = [product, ...catalog.filter((item) => item.id !== product.id)];
    setCatalog(next);
    await saveCatalog(scope, next);
    if (online && user) {
      await upsertRemoteProduct(product).catch(() => undefined);
    }
  }

  function addItem(product: Product) {
    setDraft((current) => {
      const found = current.items.find((item) => item.id === product.id);
      const items = found
        ? current.items.map((item) => item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item)
        : [...current.items, { ...product, quantity: 1 }];
      return { ...current, items };
    });
  }

  function setItemQuantity(id: string, quantity: number) {
    if (quantity <= 0) return removeItem(id);
    setDraft((current) => ({
      ...current,
      items: current.items.map((item) => item.id === id ? { ...item, quantity } : item)
    }));
  }

  function removeItem(id: string) {
    setDraft((current) => ({ ...current, items: current.items.filter((item) => item.id !== id) }));
  }

  function setDocumentType(documentType: DocumentType) {
    setDraft((current) => ({ ...current, documentType }));
  }

  function setCustomer(customer?: Customer) {
    setDraft((current) => ({ ...current, customer }));
  }

  function setPayment(paymentMethod: PaymentMethod, amountReceived?: number) {
    setDraft((current) => ({ ...current, paymentMethod, amountReceived: paymentMethod === "EFECTIVO" ? amountReceived : undefined }));
  }

  function resetDraft() {
    setDraft(initialDraft);
    setLastReceipt(undefined);
  }

  async function createReceipt() {
    if (!user) throw new Error("Debes iniciar sesión para emitir comprobantes.");
    // Mismo redondeo que el servidor: cada línea se redondea a céntimos y luego se suma.
    const totalCents = draft.items.reduce((sum, item) => sum + Math.round((item.quantity * item.unitPrice + Number.EPSILON) * 100), 0);
    const total = totalCents / 100;
    const receipt: PendingReceipt = {
      clientTransactionId: `client-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      temporaryNumber: `VT-${Date.now().toString().slice(-6)}`,
      createdAt: new Date().toISOString(),
      documentType: draft.documentType,
      items: draft.items,
      customer: draft.customer,
      total,
      paymentMethod: draft.paymentMethod,
      amountReceived: draft.paymentMethod === "EFECTIVO" ? draft.amountReceived : undefined,
      status: "PENDING"
    };
    await enqueueReceipt(scope, receipt);
    setLastReceipt(receipt);
    await refreshQueue();
    if (online) await syncNow();
    return receipt;
  }

  const pendingCount = queue.filter((r) => r.status === "PENDING" || r.status === "SYNCING" || r.status === "ERROR").length;

  const value = useMemo<AppContextValue>(() => ({
    hydrated, online, queue, history, pendingCount, profile, catalog, draft, lastReceipt,
    setProfilePatch, completeOnboarding, addProductToCatalog, addItem, setItemQuantity,
    removeItem, setDocumentType, setCustomer, setPayment, resetDraft, createReceipt, refreshQueue, refreshHistory, syncNow
  }), [hydrated, online, queue, history, pendingCount, profile, catalog, draft, lastReceipt, refreshQueue, refreshHistory, syncNow]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error("useApp must be used inside AppProvider");
  return context;
}
