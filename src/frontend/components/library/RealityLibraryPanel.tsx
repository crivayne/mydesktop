import React from "react";
import { Api } from "../../services/api";
import type { RealityLibRow } from "../../services/api";

export default function RealityLibraryPanel({ admin }: { admin?: boolean }) {
  const [rows, setRows] = React.useState<RealityLibRow[]>([]);
  const [busy, setBusy] = React.useState(false);

  const reload = React.useCallback(async () => {
    setBusy(true);
    try {
      const r = await (Api as any).listRealityLibrary();
      setRows(r || []);
    } finally {
      setBusy(false);
    }
  }, []);

  React.useEffect(() => { void reload(); }, [reload]);

  const onUpload = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".zip";
    input.onchange = async () => {
      const f = input.files?.[0];
      input.value = "";
      if (!f) return;
      const base = f.name.replace(/\.zip$/i, "");
      const name = prompt("표시 이름", base) || base;
      setBusy(true);
      try {
        await (Api as any).uploadRealityZip(f, name, () => {});
        await reload();
        alert("업로드 완료");
      } catch (e:any) {
        alert("업로드 실패: " + (e.message || e));
      } finally {
        setBusy(false);
      }
    };
    input.click();
  };

  return (
    <div style={{ display:"grid", gap: 12 }}>
      <div style={{ display:"flex", gap:8, alignItems:"center" }}>
        {admin && <button disabled={busy} onClick={onUpload}>Upload</button>}
        <button disabled={busy} onClick={reload}>Refresh</button>
      </div>

      <div style={{ border: "1px solid #333", borderRadius: 8, overflow: "hidden" }}>
        <div style={{ padding: "10px 12px", borderBottom: "1px solid #333" }}>
          <strong>Reality Library</strong>
        </div>
        <div style={{ maxHeight:"48vh", overflow:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse" }}>
            <thead>
              <tr>
                <th style={th}>Name</th>
                <th style={th}>Kind</th>
                <th style={th}>URL</th>
                {admin && <th style={{...th, width:90}}></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={td}>{r.name}</td>
                  <td style={td}>{r.kind}</td>
                  <td style={{...td, fontSize:12, opacity:.85}}>{r.url}</td>
                  {admin && (
                    <td style={{...td, textAlign:"right"}}>
                      <button disabled={busy} onClick={async ()=>{
                        if (!confirm("삭제할까요?")) return;
                        setBusy(true);
                        try {
                          await (Api as any).deleteRealityFromLibrary(r.id);
                          await reload();
                        } finally { setBusy(false); }
                      }}>Delete</button>
                    </td>
                  )}
                </tr>
              ))}
              {!rows.length && <tr><td style={{padding:12, opacity:.7}} colSpan={admin?4:3}>No items</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const th: React.CSSProperties = { textAlign:"left", padding:"8px 10px", borderBottom:"1px solid #333" };
const td: React.CSSProperties = { padding:"6px 10px", borderBottom:"1px solid #2a2a2a" };