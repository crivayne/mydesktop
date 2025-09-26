// src/frontend/components/library/SnapshotLibraryPanel.tsx
import React from "react";
import { Api, SnapshotRow } from "../../services/api";

type Props = {
  isAdmin: boolean;
  onLocateImporter: () => Promise<void> | void;
  onRunImporterCLI: () => Promise<void> | void;
  onUploadSnapshot: () => Promise<void> | void;
};

export default function SnapshotLibraryPanel({
  isAdmin,
  onLocateImporter,
  onRunImporterCLI,
  onUploadSnapshot,
}: Props) {
  const [busy, setBusy] = React.useState(false);
  const [rows, setRows] = React.useState<SnapshotRow[]>([]);

  const reload = React.useCallback(async () => {
    setBusy(true);
    try {
      const list = await Api.listSnapshotsAll();
      setRows(Array.isArray(list) ? list : []);
    } finally {
      setBusy(false);
    }
  }, []);

  React.useEffect(() => { void reload(); }, [reload]);

  return (
    <div style={{ display:"grid", gap:12 }}>
      <div style={{ display:"flex", gap:8, alignItems:"center" }}>
        <button onClick={onLocateImporter}>Importer 2.0 경로 지정…</button>
        <button onClick={onRunImporterCLI}>Importer 2.0 실행(CLI)…</button>
        {isAdmin && <button onClick={onUploadSnapshot}>스냅샷 업로드(서버)…</button>}
        <span style={{ flex:1 }} />
        <button disabled={busy} onClick={reload}>Refresh</button>
      </div>

      <div style={{ border:"1px solid #333", borderRadius:8, overflow:"hidden" }}>
        <div style={{ padding:"10px 12px", borderBottom:"1px solid #333", display:"flex", alignItems:"center" }}>
          <strong style={{ flex:1 }}>Snapshot List</strong>
          {busy && <span style={{ fontSize:12, opacity:.6 }}>Loading…</span>}
        </div>

        <div style={{ maxHeight:"48vh", overflow:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse" }}>
            <thead>
              <tr>
                <th style={th}>Name</th>
                <th style={th}>URL</th>
                <th style={{...th, width:140}}>Site</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r)=>(
                <tr key={r.id}>
                  <td style={td}>{r.name}</td>
                  <td style={{...td, fontSize:12, opacity:.85}}>{r.url}</td>
                  <td style={td}>{r.siteId || "-"}</td>
                </tr>
              ))}
              {!rows.length && (
                <tr><td style={{padding:12, opacity:.7}} colSpan={3}>No snapshots</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const th: React.CSSProperties = { textAlign:"left", padding:"8px 10px", borderBottom:"1px solid #333" };
const td: React.CSSProperties = { padding:"6px 10px", borderBottom:"1px solid #2a2a2a" };