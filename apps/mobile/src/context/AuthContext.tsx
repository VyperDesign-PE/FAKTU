import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { AuthSession, AuthUser } from "../auth/types";
import { loginWithEmail, registerWithEmail } from "../services/api";
import { clearSession, loadSession, saveSession } from "../storage/session";

type AuthContextValue = {
  hydrated: boolean;
  isAuthenticated: boolean;
  user?: AuthUser;
  signIn: (email: string, password: string) => Promise<void>;
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
  }, []);

  const persist = useCallback(async (next: AuthSession) => {
    setSession(next);
    await saveSession(next);
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    await persist(await loginWithEmail(email, password));
  }, [persist]);

  const signUp = useCallback(async (email: string, password: string) => {
    await persist(await registerWithEmail(email, password));
  }, [persist]);

  const signOut = useCallback(async () => {
    setSession(null);
    await clearSession();
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    hydrated,
    isAuthenticated: Boolean(session?.accessToken),
    user: session?.user,
    signIn,
    signUp,
    signOut
  }), [hydrated, session, signIn, signUp, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
