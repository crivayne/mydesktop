// src/frontend/components/TopBar.tsx
import React from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth, requestLogout } from "../services/AuthContext";

const bar: React.CSSProperties = {
  height: 44, display: "flex", alignItems: "center", justifyContent: "space-between",
  padding: "0 12px", borderBottom: "1px solid #2b2b2b", background: "#111",
  position: "sticky", top: 0, zIndex: 10,
};

export interface TopBarProps {
  siteName?: string;
  style?: React.CSSProperties;
  className?: string;
}

export default function TopBar({ style, className }: TopBarProps) {
  const { auth, setAuth } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();

  // siteName은 ViewerRoute에서 localStorage에 저장해두고 여기서 읽습니다.
  const siteName = React.useMemo(() => localStorage.getItem("siteName") || "-", [loc.key]);

  const onLogout = () => {
    // 컨텍스트/스토리지 정리
    setAuth(undefined);
    try {
      localStorage.setItem("auth","null");
      localStorage.removeItem("itwin-user-id");
      localStorage.removeItem("itwin-user-role");
      localStorage.removeItem("itwin-api-base");
      localStorage.removeItem("siteId");
      localStorage.removeItem("siteName");
    } catch {}
    requestLogout();          // 외부 리스너용 커스텀 이벤트 (AuthContext가 듣고 있음)
    nav("/", { replace: true });
  };

return (
    <div
        className={className}
        style={{
        // 일반 상단 헤더 형태
        height: 40,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "0 12px",
        background: "#202020ff",
        borderBottom: "1px solid #1f2937",
        boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
        // 오버레이가 아니므로 pointerEvents는 기본값(클릭 가능)
        ...style,
        }}
    >
        {/* 왼쪽: 사이트명 */}
        <div style={{ fontWeight: 700, color: "#e5e7eb" }}>
        {siteName}
        </div>

        {/* 오른쪽: 계정/버튼 */}
        <div style={{ display: "flex", gap: 12, alignItems: "center", color: "#cbd5e1" }}>
        {auth?.userId ? (
            <>
            <span>
                {auth.userId} <span style={{ opacity: 0.6 }}>({auth.role})</span>
            </span>
            <button
                onClick={() => {
                if (confirm("정말 로그아웃 하시겠습니까?")) onLogout();
                }}
                style={{
                padding: "6px 10px",
                borderRadius: 6,
                border: "1px solid #374151",
                background: "#1f2937",
                color: "#e5e7eb",
                cursor: "pointer",
                }}
            >
                Log out
            </button>
            </>
        ) : (
            <button
            onClick={() => nav("/", { replace: true })}
            style={{ padding: "6px 10px", borderRadius: 6 }}
            >
            Login
            </button>
        )}
        </div>
    </div>
    );
}