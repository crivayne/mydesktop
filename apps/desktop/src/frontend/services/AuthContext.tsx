// src/frontend/services/AuthContext.tsx
import { createContext, useContext, useMemo, useState } from "react";

type AuthState = { apiBase: string; userId: string; role: "admin"|"user" };
type Ctx = {
  auth?: AuthState;
  setAuth: (a?: AuthState)=>void;
};

const AuthCtx = createContext<Ctx>(null as any);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [auth, setAuth] = useState<AuthState | undefined>(() => {
    try { return JSON.parse(localStorage.getItem("auth") || "null") || undefined; } catch { return undefined; }
  });
  const value = useMemo(()=>({
    auth,
    setAuth: (a?:AuthState) => {
      setAuth(a);
      localStorage.setItem("auth", a ? JSON.stringify(a) : "null");
    }
  }),[auth]);
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
export const useAuth = ()=> useContext(AuthCtx);