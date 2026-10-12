import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Product } from "../domain/types";

const PREFIX = "catalog_v1";
const key = (scope: string) => `${PREFIX}:${scope}`;

export const starterCatalog: Product[] = [];
/** Antes la app sembraba productos de ejemplo; ya no (un negocio real no vende “Huevos x 12” de mentira). */
const legacyStarter: Product[] = [
  { id: "gaseosa", name: "Gaseosa 500 ml", unitPrice: 3, unit: "Unidad", favorite: true },
  { id: "agua", name: "Agua 625 ml", unitPrice: 1.5, unit: "Unidad", favorite: true },
  { id: "pan", name: "Pan", unitPrice: 0.5, unit: "Unidad", favorite: true },
  { id: "leche", name: "Leche Gloria 1 L", unitPrice: 6.9, unit: "Unidad", favorite: true },
  { id: "huevos", name: "Huevos x 12", unitPrice: 8, unit: "Paquete", favorite: true },
  { id: "arroz", name: "Arroz 1 kg", unitPrice: 4.5, unit: "Unidad", favorite: true }
];

export async function loadCatalog(scope: string): Promise<Product[]> {
  const raw = await AsyncStorage.getItem(key(scope));
  if (!raw) return starterCatalog;
  const saved = JSON.parse(raw) as Product[];
  // Se retiran solo los ejemplos que nunca se modificaron.
  const isUntouchedSeed = saved.length === legacyStarter.length && saved.every((p, i) => p.id === legacyStarter[i].id && p.unitPrice === legacyStarter[i].unitPrice && p.stockQty === undefined);
  return isUntouchedSeed ? starterCatalog : saved;
}

export async function saveCatalog(scope: string, products: Product[]) {
  await AsyncStorage.setItem(key(scope), JSON.stringify(products));
}
