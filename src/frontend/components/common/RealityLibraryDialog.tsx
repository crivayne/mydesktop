// src/frontend/components/common/RealityLibraryDialog.tsx
import React from "react";
import { Api } from "../../services/api";
import type { RealityLibRow } from "../../services/api";

type Props = {
  open: boolean;
  onClose: () => void;
  /** 사이트 내부(뷰어)에서 사용 시 선택 항목을 넘겨줌 */
  onPick?: (row: RealityLibRow) => void;
  /** 업로드/삭제 권한 */
  admin?: boolean;
};

// ▶ 이름 입력용 미니 모달
function NameModal(props: {
  open: boolean;
  initial: string;
  onCancel: () => void;
  onSubmit: (val: string) => void;
}) {
  const { open, initial, onCancel, onSubmit } = props;
  const [val, setVal] = React.useState(initial);
  React.useEffect(() => setVal(initial), [initial, open]);
  if (!open) return null;
  return (
    <div style={{
      position:"fixed", inset:0, background:"rgba(0,0,0,.5)",
      display:"flex", alignItems:"center", justifyContent:"center", zIndex:10000
    }}>
      <div style={{ width:380, background:"#1e1e1e", border:"1px solid #333", borderRadius:8, padding:14 }}>
        <div style={{ fontWeight:700, marginBottom:8 }}>표시 이름</div>
        <input
          autoFocus
          value={val}
          onChange={(e)=>setVal(e.target.value)}
          onKeyDown={(e)=>{ if (e.key==="Enter") onSubmit(val.trim() || initial); }}
          style={{ width:"100%", padding:"8px 10px", borderRadius:6, border:"1px solid #444", background:"#111", color:"#ddd" }}
          placeholder="이름을 입력하세요"
        />
        <div style={{ display:"flex", gap:8, justifyContent:"flex-end", marginTop:10 }}>
          <button onClick={onCancel}>취소</button>
          <button onClick={()=> onSubmit(val.trim() || initial)}>확인</button>
        </div>
      </div>
    </div>
  );
}

export default function RealityLibraryDialog({ open, onClose, onPick, admin }: Props) {
  const [rows, setRows] = React.useState<RealityLibRow[]>([]);
  const [busy, setBusy] = React.useState(false);

  // 파일 선택 후 이름 입력 모달용 상태
  const [pendingFile, setPendingFile] = React.useState<File | null>(null);
  const [nameOpen, setNameOpen] = React.useState(false);
  const [defaultName, setDefaultName] = React.useState("");

  const reload = React.useCallback(async () => {
    setBusy(true);
    try {
      const r = await (Api as any).listRealityLibrary();
      setRows(r || []);
    } finally {
      setBusy(false);
    }
  }, []);

  React.useEffect(() => { if (open) void reload(); }, [open, reload]);

  if (!open) return null;


  return (
    <div style={{position:"fixed", inset:0, background:"rgba(0,0,0,.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:9999}}>
      <div style={{ width:700, maxHeight:"80vh", background:"#1e1e1e", border:"1px solid #333", borderRadius:8, display:"flex", flexDirection:"column" }}>
        <div style={{ padding:12, borderBottom:"1px solid #333", display:"flex", gap:8, alignItems:"center" }}>
          <b style={{flex:1}}>Reality Library</b>
          {admin && (
            <>
              <button disabled={busy} onClick={() => {
                const input = document.createElement("input");
                input.type = "file";
                input.accept = ".zip";
                input.onchange = () => {
                  const f = input.files?.[0];
                  // 같은 파일 두 번 연속 선택 가능하도록 리셋
                  input.value = "";
                  if (!f) return;
                  // 기본 이름은 파일명(확장자 제거)
                  const base = f.name.replace(/\.zip$/i, "");
                  setDefaultName(base);
                  setPendingFile(f);
                  setNameOpen(true);
                };
                input.click();
              }}>Upload</button>
              <button disabled={busy} onClick={reload}>Refresh</button>
            </>
          )}
          <button onClick={onClose}>Close</button>
        </div>

        <div style={{ overflow:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse" }}>
            <thead>
              <tr>
                <th style={{textAlign:"left", padding:"8px 10px", borderBottom:"1px solid #333"}}>Name</th>
                <th style={{textAlign:"left", padding:"8px 10px", borderBottom:"1px solid #333"}}>Kind</th>
                <th style={{textAlign:"left", padding:"8px 10px", borderBottom:"1px solid #333"}}>URL</th>
                {admin && <th style={{width:90}}></th>}
                {onPick && <th style={{width:90}}></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ padding:"6px 10px", borderBottom:"1px solid #2a2a2a" }}>{r.name}</td>
                  <td style={{ padding:"6px 10px", borderBottom:"1px solid #2a2a2a" }}>{r.kind}</td>
                  <td style={{ padding:"6px 10px", borderBottom:"1px solid #2a2a2a", fontSize:12, opacity:.8 }}>{r.url}</td>
                  {admin && (
                    <td style={{ textAlign:"right", padding:"6px 10px", borderBottom:"1px solid #2a2a2a" }}>
                      <button disabled={busy} onClick={async ()=> {
                        if (!confirm("삭제할까요?")) return;
                        setBusy(true);
                        try {
                          await (Api as any).deleteRealityFromLibrary(r.id);
                          await reload();
                        } finally { setBusy(false); }
                      }}>Delete</button>
                    </td>
                  )}
                  {onPick && (
                    <td style={{ textAlign:"right", padding:"6px 10px", borderBottom:"1px solid #2a2a2a" }}>
                      <button onClick={()=> onPick?.(r)}>Open</button>
                    </td>
                  )}
                </tr>
              ))}
              {!rows.length && <tr><td style={{padding:12, opacity:.7}}>No items</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* 파일명 입력 모달 */}
      <NameModal
        open={nameOpen}
        initial={defaultName}
        onCancel={() => { setNameOpen(false); setPendingFile(null); }}
        onSubmit={async (finalName) => {
          const f = pendingFile;
          setNameOpen(false);
          if (!f) return;
          setBusy(true);
          try {
            await (Api as any).uploadRealityZip(f, finalName, () => {});
            await reload();
            alert("업로드 완료");
          } catch (e:any) {
            alert("업로드 실패: " + (e.message || e));
          } finally {
            setBusy(false);
            setPendingFile(null);
          }
        }}
      />
    </div>
  );
}