import React from "react";
import RealityLibraryPanel from "./RealityLibraryPanel";
import { Api, SnapshotRow } from "../../services/api";

type Props = {
  open: boolean;
  onClose: () => void;
  isAdmin: boolean;

  // Snapshot 탭 버튼 핸들러 (ProjectSitePanel에서 넘겨줌)
  onLocateImporter: () => Promise<void> | void;
  onRunImporterCLI: () => Promise<void> | void;
  onUploadSnapshot: () => Promise<void> | void;
};

export default function MainLibraryDialog({
  open,
  onClose,
  isAdmin,
  onLocateImporter,
  onRunImporterCLI,
  onUploadSnapshot,
}: Props) {
  const [tab, setTab] = React.useState<"model" | "snapshot" | "reality">("model");
  const [snapshots, setSnapshots] = React.useState<SnapshotRow[]>([]);
  const [busy, setBusy] = React.useState(false);

  const reloadSnapshots = React.useCallback(async () => {
    setBusy(true);
    try {
      const list = await Api.listSnapshotsAll();
      setSnapshots(Array.isArray(list) ? list : []);
    } finally {
      setBusy(false);
    }
  }, []);

  React.useEffect(() => {
    if (!open) return;
    if (tab === "snapshot") void reloadSnapshots();
  }, [open, tab, reloadSnapshots]);

  if (!open) return null;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: "rgba(0,0,0,.5)", display: "flex",
      alignItems: "center", justifyContent: "center",
    }}>
      <div style={{
        width: 920, maxHeight: "82vh", background: "#1e1e1e",
        border: "1px solid #333", borderRadius: 10, display: "flex", flexDirection: "column"
      }}>
        {/* Header */}
        <div style={{ padding: 12, borderBottom: "1px solid #333", display: "flex", alignItems: "center", gap: 8 }}>
          <b style={{ flex: 1 }}>Main Library</b>
          <button onClick={onClose}>Close</button>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 8, padding: "10px 12px", borderBottom: "1px solid #333" }}>
          <TabBtn active={tab==="model"} onClick={()=>setTab("model")}>Model</TabBtn>
          <TabBtn active={tab==="snapshot"} onClick={()=>setTab("snapshot")}>Snapshot</TabBtn>
          <TabBtn active={tab==="reality"} onClick={()=>setTab("reality")}>Reality Data</TabBtn>
        </div>

        {/* Body */}
        <div style={{ padding: 12, overflow: "auto" }}>
          {tab === "model" && (
            <div style={{ opacity:.85 }}>
              <h3 style={{ marginTop: 0 }}>Model Library (gltf/glb)</h3>
              <div style={{ padding: 12, border: "1px dashed #444", borderRadius: 8 }}>
                <div style={{ marginBottom: 8 }}>여기에 glTF / GLB 업로드 & 목록 관리 UI 추가 예정</div>
                <small style={{ opacity:.7 }}>※ 여러 개 배치 가능한 형식으로 관리합니다. (추후 구현)</small>
              </div>
            </div>
          )}

          {tab === "snapshot" && (
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button onClick={onLocateImporter}>Importer 2.0 경로 지정…</button>
                <button onClick={onRunImporterCLI}>Importer 2.0 실행(CLI)…</button>
                {isAdmin && <button onClick={onUploadSnapshot}>스냅샷 업로드(서버)…</button>}
                <span style={{ flex:1 }} />
                <button disabled={busy} onClick={reloadSnapshots}>Refresh</button>
              </div>

              <div style={{ border: "1px solid #333", borderRadius: 8, overflow: "hidden" }}>
                <div style={{ padding: "10px 12px", borderBottom: "1px solid #333", display:"flex", alignItems:"center" }}>
                  <strong style={{ flex: 1 }}>Snapshot List</strong>
                  {busy && <span style={{ fontSize:12, opacity:.6 }}>Loading…</span>}
                </div>

                <div style={{ maxHeight: "48vh", overflow: "auto" }}>
                  <table style={{ width:"100%", borderCollapse:"collapse" }}>
                    <thead>
                      <tr>
                        <th style={th}>Name</th>
                        <th style={th}>URL</th>
                        <th style={{...th, width: 140}}>Site</th>
                      </tr>
                    </thead>
                    <tbody>
                      {snapshots.map((s) => (
                        <tr key={s.id}>
                          <td style={td}>{s.name}</td>
                          <td style={{...td, fontSize:12, opacity:.85}}>{s.url}</td>
                          <td style={td}>{s.siteId || "-"}</td>
                        </tr>
                      ))}
                      {!snapshots.length && (
                        <tr><td style={{padding:12, opacity:.7}} colSpan={3}>No snapshots</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {tab === "reality" && (
            <RealityLibraryPanel admin={isAdmin} />
          )}
        </div>
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active?: boolean; onClick: ()=>void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "6px 12px",
        borderRadius: 8,
        border: "1px solid " + (active ? "#58a6ff" : "#444"),
        background: active ? "rgba(88,166,255,.14)" : "#222",
        color: "#ddd",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

const th: React.CSSProperties = { textAlign:"left", padding:"8px 10px", borderBottom:"1px solid #333" };
const td: React.CSSProperties = { padding:"6px 10px", borderBottom:"1px solid #2a2a2a" };