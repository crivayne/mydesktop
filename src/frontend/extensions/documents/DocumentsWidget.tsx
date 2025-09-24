// src/frontend/extensions/documents/DocumentsWidget.tsx
import React from "react";
import { Button, InputGroup, LabeledSelect, ProgressRadial, Table, Text } from "@itwin/itwinui-react";
import { StagePanelLocation, StagePanelSection, UiItemsProvider, Widget, WidgetState, UiFramework } from "@itwin/appui-react";
import type { SelectOption, } from "@itwin/itwinui-react";
import { useAuth } from "../../services/AuthContext";
import DocumentsApi, { DocItem } from "./DocumentsApi";

type RowT = { key: number; name: string; ext: string; state: string; open: JSX.Element };

const extOptions: SelectOption<string>[] = [
  { value: "all",  label: "All" },
  { value: "pdf",  label: "pdf" },
  { value: "xlsx", label: "xlsx" },
  { value: "csv",  label: "csv" },
  { value: "jpg",  label: "jpg" },
  { value: "png",  label: "png" },
];

const DocumentsWidget: React.FC = () => {
  const authCtx = useAuth();
  const auth = authCtx?.auth ?? (() => {
    try { return JSON.parse(localStorage.getItem("auth") || "null") || undefined; }
    catch { return undefined; }
  })();
  const isAdmin = auth?.role === "admin";
  const siteId = React.useMemo(()=> localStorage.getItem("siteId") || "", []);
  const [items, setItems] = React.useState<DocItem[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string|undefined>();
  const [q, setQ] = React.useState("");
  const [ext, setExt] = React.useState("all");
  const [selId, setSelId] = React.useState<number|undefined>(); // 리스트 선택

  const reload = React.useCallback(async ()=>{
    if (!siteId) { setError("siteId가 없습니다."); return; }
    setLoading(true); setError(undefined);
    try {
      const list = await DocumentsApi.list({ siteId, q: q.trim() || undefined, ext: ext!=="all" ? ext : undefined });
      setItems(list);
    } catch(e:any) {
      setError(e?.message || "load failed");
    } finally { setLoading(false); }
  }, [siteId, q, ext]);

  React.useEffect(()=>{ void reload(); }, [reload]);

  const onAdd = async () => {
    if (!isAdmin) return;
    if (!auth?.userId || !siteId) return alert("로그인이 필요합니다.");
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".pdf,.xlsx,.csv,.jpg,.jpeg,.png";
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      try {
        setLoading(true);
        const created = await DocumentsApi.upload(siteId, auth.userId, f);
        setItems(prev => [created, ...prev]);
      } catch(e:any) {
        alert(`Upload failed: ${e?.message || e}`);
      } finally { setLoading(false); }
    };
    input.click();
  };

  const onRename = async () => {
    if (!isAdmin) return;
    if (!auth?.userId || !siteId) return alert("로그인이 필요합니다.");
    const it = items.find(i => i.id === selId);
    if (!it) return alert("먼저 항목을 선택하세요.");
    const newName = prompt("새 파일명(확장자 제외):", it.curr_name)?.trim();
    if (!newName) return;

    try {
      setLoading(true);
      await DocumentsApi.rename(siteId, it.id, newName, auth.userId);
      setItems(prev => prev.map(r => r.id===it.id ? { ...r, curr_name: newName, state:"renamed", lasteditBy:auth.userId, lasteditAt:new Date().toISOString().slice(0,19).replace('T',' ') } : r));
    } catch(e:any) {
      alert(`Rename failed: ${e?.message || e}`);
    } finally { setLoading(false); }
  };

  const onDelete = async () => {
    if (!isAdmin) return;
    if (!auth?.userId || !siteId) return alert("로그인이 필요합니다.");
    const it = items.find(i => i.id === selId);
    if (!it) return alert("먼저 항목을 선택하세요.");
    if (!confirm("리스트에서 삭제(상태: deleted) 하시겠습니까? 서버 파일은 유지됩니다.")) return;

    try {
      setLoading(true);
      await DocumentsApi.markDelete(siteId, it.id, auth.userId);
      setItems(prev => prev.map(r => r.id===it.id ? { ...r, state:"deleted", lasteditBy:auth.userId, lasteditAt:new Date().toISOString().slice(0,19).replace('T',' ') } : r));
    } catch(e:any) {
      alert(`Delete failed: ${e?.message || e}`);
    } finally { setLoading(false); }
  };

  const onDownload = () => {
    const it = items.find(i => i.id === selId);
    if (!it) return alert("먼저 항목을 선택하세요.");
    const url = DocumentsApi.downloadUrl(siteId, it.id);
    window.open(url, "_blank");
  };

  const onOpen = (it: DocItem) => {
    // 브라우저에서 바로 열기(이미지, pdf 등)
    const url = DocumentsApi.openUrl(siteId, it);
    window.open(url, "_blank");
  };

  // 간단 테이블
  type ColumnT = { Header: string; accessor: keyof RowT };
  const columns: ColumnT[] = [
    { Header: "Name",  accessor: "name"  as const },
    { Header: "Ext",   accessor: "ext"   as const },
    { Header: "State", accessor: "state" as const },
    { Header: "Open",  accessor: "open"  as const },
  ];
  const data = items
    .filter(r=>true) // 필요시 추가 필터
    .map((r)=>({
      key: r.id,
      name: `${r.curr_name}.${r.ext}`,
      ext: r.ext,
      state: r.state,
      open: <Button size="small" onClick={()=>onOpen(r)}>Open</Button>,
    }));

  return (
    <div style={{ padding: 8, color:"#fff" }}>
      {/* 상단 버튼 */}
      <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:8 }}>
        {isAdmin && <Button size="small" onClick={onAdd}>Add</Button>}
        {isAdmin && <Button size="small" onClick={onRename} disabled={!selId}>Rename</Button>}
        {isAdmin && <Button size="small" onClick={onDelete} disabled={!selId}>Delete</Button>}
        <Button size="small" onClick={onDownload} disabled={!selId}>Down</Button>
        <Button size="small" styleType="high-visibility" onClick={reload}>Sync</Button>
      </div>

      {/* 검색/필터 */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 180px", gap:8, marginBottom:8 }}>
        <InputGroup label="Search">
          <input value={q} onChange={(e)=>setQ(e.target.value)} onKeyDown={(e)=>{ if (e.key==="Enter") reload(); }} />
        </InputGroup>
        <LabeledSelect label="Ext" size="small" displayStyle="inline"
          options={extOptions} value={ext}
          onChange={(v:string)=>setExt(v)} />
      </div>

      {loading && <div style={{ display:"flex", placeContent:"center" }}><ProgressRadial indeterminate size="small" /></div>}
      {!loading && error && <div style={{ color:"#ff7b7b", margin:"6px 0" }}>{error}</div>}

      {!loading && !error && (
        <Table<RowT>
        columns={columns}
        data={data}
        emptyTableContent="No documents"
        density="extra-condensed"
        onRowClick={(_ev, row) => setSelId(Number((row as any).original.key))}
        rowProps={(row) => ({
            style: {
                cursor: "pointer",
                background: Number((row as any).original.key) === selId ? "rgba(255,255,255,0.06)" : "transparent",
            },
        })}
        />
      )}
    </div>
  );
};

export class DocumentsWidgetProvider implements UiItemsProvider {
  public readonly id: string = "DocumentsWidgetProvider";
  public provideWidgets(_stageId: string, _stageUsage: string, location: StagePanelLocation, section?: StagePanelSection): ReadonlyArray<Widget> {
    const widgets: Widget[] = [];
    // 좌측 패널의 상단 섹션에 표시 (요구사항)
    if (location === StagePanelLocation.Left && section === StagePanelSection.Start) {
      widgets.push({
        id: "DocumentsWidget",
        label: "Documents",
        defaultState: WidgetState.Hidden,   // 진입 시 비활성
        content: <DocumentsWidget />,
      });
    }
    return widgets;
  }
}

export default DocumentsWidget;