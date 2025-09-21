// src/frontend/services/AuthContext.tsx
import { createContext, useContext, useEffect, useMemo, useState } from "react";

type AuthState = { apiBase: string; userId: string; role: "admin"|"user" };
type Ctx = {
  auth?: AuthState;
  setAuth: (a?: AuthState)=>void;
};

const AuthCtx = createContext<Ctx>(null as any);

// 🔸 외부에서 호출할 헬퍼: 로그아웃 요청 이벤트 디스패치
export function requestLogout() {
  // 필요시 즉시 로컬스토리지도 정리(새로고침 대비)
  try { localStorage.setItem("auth", "null"); } catch {}
  window.dispatchEvent(new Event("auth:logout"));
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [auth, setAuth] = useState<AuthState | undefined>(() => {
    try { return JSON.parse(localStorage.getItem("auth") || "null") || undefined; } catch { return undefined; }
  });

  // 🔸 외부에서 발생시킨 'auth:logout' 이벤트를 받아 상태를 지움
  useEffect(() => {
    const onLogout = () => setAuth(undefined);
    window.addEventListener("auth:logout", onLogout);
    return () => window.removeEventListener("auth:logout", onLogout);
  }, []);

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