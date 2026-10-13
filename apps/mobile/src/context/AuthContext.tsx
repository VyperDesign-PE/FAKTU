import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { AuthSession, AuthUser } from "../auth/types";
import { loginWithEmail, logoutRemote, registerWithEmail, verifyMfaLogin } from "../services/api";
import { clearSession, loadSession, onSessionInvalid, saveSession } from "../storage/session";

type AuthContextValue = {
  hydrated: boolean;
  isAuthenticated: boolean;
  user?: AuthUser;
  /** Devuelve el token del paso de 2FA si la cuenta lo exige; si no, inicia sesión. */
  signIn: (email: string, password: string) => Promise<{ mfaToken?: string }>;
  completeMfa: (mfaToken: string, code: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [hydrated, setHydrated] = useState(false);
  const [session, setSession] = useState<AuthSession | null>(null);

  useEffect(() => {
    loadSession()
      .then(setSession)
      .finally(() => setHydrated(true));
    // Si la renovación es rechazada (sesión cerrada en otro lado o token robado), vuelve al ingreso.
    return onSessionInvalid(() => setSession(null));
  }, []);

  const persist = useCallback(async (next: AuthSession) => {
    setSession(next);
    await saveSession(next);
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const result = await loginWithEmail(email, password);
    if ("mfaRequired" in result) return { mfaToken: result.mfaToken };
    await persist(result);
    return {};
  }, [persist]);

  const completeMfa = useCallback(async (mfaToken: string, code: string) => {
    await persist(await verifyMfaLogin(mfaToken, code));
  }, [persist]);

  const signUp = useCallback(async (email: string, password: string) => {
    await persist(await registerWithEmail(email, password));
  }, [persist]);

  const signOut = useCallback(async () => {
    await logoutRemote();
    setSession(null);
    await clearSession();
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    hydrated,
    isAuthenticated: Boolean(session?.accessToken),
    user: session?.user,
    signIn,
    completeMfa,
    signUp,
    signOut
  }), [hydrated, session, signIn, completeMfa, signUp, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
