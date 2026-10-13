import AsyncStorage from "@react-native-async-storage/async-storage";
import type { PendingReceipt } from "../domain/types";

const PREFIX = "receipt_queue_v1";
const key = (scope: string) => `${PREFIX}:${scope}`;

/**
 * Toda lectura-modificación-escritura de la cola pasa por esta cadena de promesas (una por
 * alcance): así una venta nueva y una sincronización simultáneas no se pisan entre sí.
 */
const chains = new Map<string, Promise<unknown>>();
function serialized<T>(scope: string, work: () => Promise<T>): Promise<T> {
  const run = (chains.get(scope) ?? Promise.resolve()).then(work, work);
  chains.set(scope, run.catch(() => undefined));
  return run;
}

async function read(scope: string): Promise<PendingReceipt[]> {
  const raw = await AsyncStorage.getItem(key(scope));
  return raw ? JSON.parse(raw) : [];
}

export function getQueue(scope: string): Promise<PendingReceipt[]> {
  return serialized(scope, () => read(scope));
}

export function saveQueue(scope: string, queue: PendingReceipt[]) {
  return serialized(scope, () => AsyncStorage.setItem(key(scope), JSON.stringify(queue)));
}

export function enqueueReceipt(scope: string, receipt: PendingReceipt) {
  return serialized(scope, async () => {
    const queue = await read(scope);
    queue.push(receipt);
    await AsyncStorage.setItem(key(scope), JSON.stringify(queue));
  });
}

export function patchReceipt(scope: string, clientTransactionId: string, patch: Partial<PendingReceipt>) {
  return serialized(scope, async () => {
    const next = (await read(scope)).map((item) => (item.clientTransactionId === clientTransactionId ? { ...item, ...patch } : item));
    await AsyncStorage.setItem(key(scope), JSON.stringify(next));
    return next;
  });
}
