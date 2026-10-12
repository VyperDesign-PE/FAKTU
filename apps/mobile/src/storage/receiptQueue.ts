import AsyncStorage from "@react-native-async-storage/async-storage";
import type { PendingReceipt } from "../domain/types";

const PREFIX = "receipt_queue_v1";
const key = (scope: string) => `${PREFIX}:${scope}`;

export async function getQueue(scope: string): Promise<PendingReceipt[]> {
  const raw = await AsyncStorage.getItem(key(scope));
  return raw ? JSON.parse(raw) : [];
}

export async function saveQueue(scope: string, queue: PendingReceipt[]) {
  await AsyncStorage.setItem(key(scope), JSON.stringify(queue));
}

export async function enqueueReceipt(scope: string, receipt: PendingReceipt) {
  const queue = await getQueue(scope);
  queue.push(receipt);
  await saveQueue(scope, queue);
}

export async function patchReceipt(scope: string, clientTransactionId: string, patch: Partial<PendingReceipt>) {
  const queue = await getQueue(scope);
  const next = queue.map((item) =>
    item.clientTransactionId === clientTransactionId ? { ...item, ...patch } : item
  );
  await saveQueue(scope, next);
  return next;
}
