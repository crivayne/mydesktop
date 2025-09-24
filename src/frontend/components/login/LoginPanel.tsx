import React, { useEffect, useMemo, useState } from "react";

type Props = {
  /** 로그인 성공 시 호출: { id, apiBase } */
  onSuccess: (info: { id: string; apiBase: string; role: "admin" | "user" }) => void;
};

const row: React.CSSProperties = { display: "grid", gridTemplateColumns: "120px 1fr", gap: 12, alignItems: "center", marginBottom: 12 };
const label: React.CSSProperties = { textAlign: "right", color: "#555", fontWeight: 600 };
const input: React.CSSProperties = { padding: "10px 12px", border: "1px solid #ccc", borderRadius: 6, outline: "none" };
const card: React.CSSProperties  = { width: 420, padding: 24, border: "1px solid #e5e5e5", borderRadius: 12, boxShadow: "0 6px 18px rgba(0,0,0,0.06)", background: "#fff" };

const LoginPanel: React.FC<Props> = ({ onSuccess }) => {
  // 입력값 (최근 값 복구)
  const last = useMemo(() => {
    try { return JSON.parse(localStorage.getItem("loginForm") || "{}"); } catch { return {}; }
  }, []);

  const [ip, setIp] = useState<string>(last.ip ?? "127.0.0.1");
  const [port, setPort] = useState<string>(last.port ?? "80");
  const [userId, setUserId] = useState<string>(last.userId ?? "");
  const [password, setPassword] = useState<string>("");

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem("loginForm", JSON.stringify({ ip, port, userId }));
  }, [ip, port, userId]);

  const apiBase = useMemo(() => {
    // 포트가 80/443이 아니면 :포트 포함
    const p = (port || "").trim();
    const host = ip.trim();
    if (!host) return "";
    const isHttps = p === "443";
    const scheme = isHttps ? "https" : "http";
    const withPort = p && p !== "80" && p !== "443" ? `:${p}` : "";
    return `${scheme}://${host}${withPort}`;
  }, [ip, port]);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setErr(null);

    if (!apiBase) return setErr("IP/Port를 확인하세요.");
    if (!userId || !password) return setErr("ID와 Password를 입력하세요.");

    try {
      setBusy(true);

      const res = await fetch(`${apiBase}/itwin/api/login.php`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: userId, pw: password }),
      });

      if (!res.ok) {
        // CORS/네트워크 오류일 수 있음
        throw new Error(`HTTP ${res.status}`);
      }

      const data: { result: "success" | "fail" | "error"; msg?: string; role?: "admin" | "user" } = await res.json();

      if (data.result === "success") {
        // role이 없으면 별도 API로 조회(선택)
        let role = data.role;
        if (!role) {
          try {
            const r2 = await fetch(`${apiBase}/itwin/api/users/getRole.php?id=${encodeURIComponent(userId)}`);
            if (r2.ok) {
              const d2: { role?: "admin" | "user" } = await r2.json();
              role = d2.role ?? "user";
            } else {
              role = "user";
            }
          } catch {
            role = "user";
          }
        }
        onSuccess({ id: userId, apiBase, role });
      } else if (data.result === "fail") {
        setErr("ID 또는 비밀번호가 올바르지 않습니다.");
      } else {
        setErr(data.msg || "서버 에러");
      }
    } catch (e: any) {
      setErr(`연결 실패: ${e.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div   
      style={{
      width: "100%",
      height: "100%",
      minHeight: "100vh",
      display: "grid",
      placeItems: "center", /*background: "linear-gradient(180deg,#f7f9fc,#eef2f7)"*/ 
      }}
    >
      <form onSubmit={handleSubmit} style={card}>
        <h2 style={{ marginTop: 0, marginBottom: 16 }}>🔐 Local Server Login</h2>

        <div style={row}>
          <div style={label}>IP</div>
          <input style={input} placeholder="127.0.0.1" value={ip} onChange={(e) => setIp(e.target.value)} />
        </div>

        <div style={row}>
          <div style={label}>Port</div>
          <input style={input} placeholder="80" value={port} onChange={(e) => setPort(e.target.value)} />
        </div>

        <div style={row}>
          <div style={label}>ID</div>
          <input style={input} placeholder="admin" value={userId} onChange={(e) => setUserId(e.target.value)} />
        </div>

        <div style={row}>
          <div style={label}>Password</div>
          <input style={input} placeholder="••••••" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>

        {apiBase && (
          <div style={{ marginTop: 6, marginBottom: 8, color: "#6b7280", fontSize: 12 }}>
            API Base: <code>{apiBase}</code>
          </div>
        )}

        {err && (
          <div style={{ marginTop: 8, marginBottom: 8, color: "#b91c1c", fontWeight: 600 }}>
            {err}
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          style={{
            width: "100%",
            padding: "12px 14px",
            borderRadius: 8,
            background: busy ? "#9ca3af" : "#2563eb",
            color: "#fff",
            fontWeight: 700,
            border: "none",
            cursor: busy ? "not-allowed" : "pointer",
            marginTop: 4,
          }}
        >
          {busy ? "Connecting..." : "Login"}
        </button>

        <div style={{ marginTop: 10, color: "#6b7280", fontSize: 12 }}>
          * 서버의 <code>login.php</code>는 JSON({`{ id, pw }`})을 받아 {"{ result: 'success' | 'fail' }"} 형식으로 응답해야 합니다.
        </div>
      </form>
    </div>
  );
};

export default LoginPanel;