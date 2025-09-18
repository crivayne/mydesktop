import React from "react";

export default function BusyOverlay(props: { open: boolean; label?: string; percent?: number | null }) {
  if (!props.open) return null;
  const p = props.percent ?? null;
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 99999,
      background: "rgba(0,0,0,0.5)", display: "flex",
      alignItems: "center", justifyContent: "center"
    }}>
      <div style={{ background: "#1c1c1c", border: "1px solid #333", borderRadius: 10, padding: 16, minWidth: 320 }}>
        <div style={{ marginBottom: 10, fontWeight: 700 }}>{props.label || "작업 중…"}</div>
        <div style={{ height: 8, background: "#222", borderRadius: 4, overflow: "hidden" }}>
          <div style={{
            width: p==null ? "100%" : `${Math.max(1, Math.min(100, Math.round(p*100)))}%`,
            height: "100%", background: "#5cbcf6",
            transition: "width .2s",
            animation: p==null ? "indet 1.2s linear infinite" : "none"
          }} />
        </div>
        <style>{`@keyframes indet{
          0%{transform: translateX(-100%)}
          50%{transform: translateX(0)}
          100%{transform: translateX(100%)}
        }`}</style>
        {p!=null && <div style={{ marginTop: 6, textAlign: "right", opacity: .8 }}>{Math.round(p*100)}%</div>}
      </div>
    </div>
  );
}