import AsyncStorage from "@react-native-async-storage/async-storage";

export type CachedCustomer = {
  documentType: "DNI" | "RUC";
  documentNumber: string;
  name: string;
  address?: string;
  phone?: string;
  email?: string;
  source?: string;
  updatedAt: string;
};

const PREFIX = "customer_cache_v1";
const key = (scope: string) => `${PREFIX}:${scope}`;
const customerKey = (type: "DNI" | "RUC", number: string) => `${type}:${number}`;

async function loadMap(scope: string): Promise<Record<string, CachedCustomer>> {
  const raw = await AsyncStorage.getItem(key(scope));
  return raw ? JSON.parse(raw) : {};
}

export async function findCachedCustomer(scope: string, type: "DNI" | "RUC", number: string) {
  const map = await loadMap(scope);
  return map[customerKey(type, number)];
}

export async function listCachedCustomers(scope: string) {
  const map = await loadMap(scope);
  return Object.values(map).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export async function saveCachedCustomer(scope: string, customer: CachedCustomer) {
  const map = await loadMap(scope);
  map[customerKey(customer.documentType, customer.documentNumber)] = customer;

  // Límite defensivo para no crecer indefinidamente en dispositivos de gama baja.
  const entries = Object.entries(map)
    .sort((a, b) => new Date(b[1].updatedAt).getTime() - new Date(a[1].updatedAt).getTime())
    .slice(0, 2000);

  await AsyncStorage.setItem(key(scope), JSON.stringify(Object.fromEntries(entries)));
}
