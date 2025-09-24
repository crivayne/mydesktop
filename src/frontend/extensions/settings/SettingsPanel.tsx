// src/frontend/extensions/settings/SettingsPanel.tsx
import React from "react";
import RenderSettings from "./RenderSettings";
import KeySettings from "./KeySettings";
import { useAuth } from "../../services/AuthContext"; // ★ 추가

export default function SettingsPanel(props: { onClose: () => void }) {
  const [tab, setTab] = React.useState<"render" | "keys">("render");
  const { auth } = useAuth(); // ★ 현재 로그인 정보
  const accountKey = (auth?.userId || "guest").toLowerCase(); // ★ 계정키 결정

  const TabButton: React.FC<{ id: "render" | "keys"; label: string }> = ({ id, label }) => (
    <button
      onClick={() => setTab(id)}
      style={{
        padding: "6px 10px",
        border: "1px solid #333",
        background: tab === id ? "#2a2a2a" : "#1e1e1e",
        color: "#ddd",
        borderBottom: tab === id ? "2px solid #6495ed" : "1px solid #333",
        borderRadius: 6,
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ width: 540, background: "#1e1e1e", border: "1px solid #333", borderRadius: 10, padding: 16 }}>
      <h3 style={{ marginTop: 0 }}>Settings</h3>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <TabButton id="render" label="Render" />
        <TabButton id="keys" label="Keys" />
        <div style={{ flex: 1 }} />
        <button onClick={props.onClose}>닫기</button>
      </div>

      {/* Body */}
      <div style={{ borderTop: "1px solid #333", paddingTop: 12 }}>
        {tab === "render" ? (
          <RenderSettings open={true} onClose={props.onClose} />
        ) : (
          <KeySettings accountKey={accountKey} />
        )}
      </div>
    </div>
  );
}
