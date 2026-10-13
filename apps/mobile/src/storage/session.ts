import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import type { AuthSession } from "../auth/types";

const SESSION_KEY = "faktu.auth-session.v1";

/**
 * En el celular la sesión vive en el almacenamiento seguro del sistema
 * (Keychain/Keystore). En el navegador no existe SecureStore: se usa
 * localStorage del dominio de FAKTU (el token expira en 7 días).
 */
const store = Platform.OS === "web"
  ? {
      async get() { return globalThis.localStorage?.getItem(SESSION_KEY) ?? null; },
      async set(value: string) { globalThis.localStorage?.setItem(SESSION_KEY, value); },
      async remove() { globalThis.localStorage?.removeItem(SESSION_KEY); }
    }
  : {
      get: () => SecureStore.getItemAsync(SESSION_KEY),
      set: (value: string) => SecureStore.setItemAsync(SESSION_KEY, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
      remove: () => SecureStore.deleteItemAsync(SESSION_KEY)
    };

export async function saveSession(session: AuthSession): Promise<void> {
  await store.set(JSON.stringify(session));
}

export async function loadSession(): Promise<AuthSession | null> {
  const raw = await store.get();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthSession;
  } catch {
    await store.remove();
    return null;
  }
}

export async function clearSession(): Promise<void> {
  await store.remove();
}

export async function getAccessToken(): Promise<string | null> {
  return (await loadSession())?.accessToken ?? null;
}

// Avisos a la app cuando la sesión deja de ser válida (renovación rechazada).
const invalidListeners = new Set<() => void>();
export function onSessionInvalid(listener: () => void) {
  invalidListeners.add(listener);
  return () => { invalidListeners.delete(listener); };
}
export function notifySessionInvalid() {
  for (const listener of invalidListeners) listener();
}
