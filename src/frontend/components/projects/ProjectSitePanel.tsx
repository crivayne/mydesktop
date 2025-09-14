// src/frontend/components/projects/ProjectSitePanel.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { IpcApp } from "@itwin/core-frontend";
import { channelName } from "../../../common/ViewerConfig";
import { Api } from "../../services/api";

// 간단 폼 POST (PHP의 $_POST 호환)
async function postForm<T>(url: string, data: Record<string, string>) {
  const body = new URLSearchParams(data as any);
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body,
  });
  if (!r.ok) {
    const text = await r.text().catch(()=> "");
    throw new Error(`${r.status} ${r.statusText} - ${text}`);
  }
  return r.json() as Promise<T>;
}

// ===== 이름 입력 모달 =====
function NameDialog(props: {
  open: boolean;
  title: string;
  initial?: string;
  placeholder?: string;
  onCancel: () => void;
  onSubmit: (value: string) => void;
}) {
  const { open, title, initial = "", placeholder = "이름을 입력하세요", onCancel, onSubmit } = props;
  const [val, setVal] = React.useState(initial);
  React.useEffect(() => setVal(initial), [initial, open]);
  if (!open) return null;
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999,
    }}>
      <div style={{ background: "#1e1e1e", border: "1px solid #333", borderRadius: 8, width: 420, padding: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 10 }}>{title}</div>
        <input
          autoFocus
          value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder={placeholder}
          style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #444", background: "#111", color: "#ddd" }}
          onKeyDown={(e) => { if (e.key === "Enter") onSubmit(val.trim()); }}
        />
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
          <button onClick={onCancel}>취소</button>
          <button onClick={() => onSubmit(val.trim())} disabled={!val.trim()}>확인</button>
        </div>
      </div>
    </div>
  );
}

type Props = {
  userId: string;
  apiBase: string;                    // 로그인에서 받은 베이스 (예: http://127.0.0.1/itwin/api)
  isAdmin: boolean;
  onOpenSite: (info: { siteId: string; siteName: string }) => void;
};

type Project = { id: string; name: string; createdAt?: string; createdBy?: string };
type Site = {
  id: string;
  projectId?: string | null;
  name: string;
  thumbnail?: string | null;
  snapshotUrl?: string | null;       // sites.snapshotUrl (최근 로드 경로)
  createdAt?: string;
  createdBy?: string;
};

type OpenDialogReturnValue = { canceled: boolean; filePaths: string[] };

export default function ProjectSitePanel({ userId, apiBase, isAdmin, onOpenSite }: Props) {
  // --- PHP API 베이스 (Vite + 로그인 값 + /itwin/api 보장) ---
  const PHP_BASE = useMemo(() => {
    const fromLogin = (apiBase || "").trim();
    const fromEnv = ((import.meta as any).env?.VITE_PHP_API_BASE as string | undefined) || "";
    const fallback = `${window.location.protocol}//${window.location.host}`;
    const base = fromLogin || fromEnv || fallback;
    return base.endsWith("/itwin/api") ? base : base.replace(/\/$/, "") + "/itwin/api";
  }, [apiBase]);

  // --- 상태 ---
  const [projects, setProjects] = useState<Project[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | "ALL">("ALL");
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingSites, setLoadingSites] = useState(true);
  const [busy, setBusy] = useState(false);

  const [nameDlgOpen, setNameDlgOpen] = useState(false);
  const [nameDlgTitle, setNameDlgTitle] = useState("");
  const [nameDlgInitial, setNameDlgInitial] = useState("");
  const nameDlgResolveRef = React.useRef<((v: string | null) => void) | null>(null);

  // 이름 입력을 Promise로 받는 헬퍼
  const askName = React.useCallback((title: string, initial = ""): Promise<string | null> => {
    setNameDlgTitle(title);
    setNameDlgInitial(initial);
    setNameDlgOpen(true);
    return new Promise((resolve) => { nameDlgResolveRef.current = resolve; });
  }, []);

  // 숨김 파일 입력 (필요 시 스냅샷 업로드에 사용)
  const fileRef = useRef<HTMLInputElement>(null);

  // --- 공통 fetch helper ---
  async function getJSON<T>(url: string): Promise<T> {
    const r = await fetch(url, { headers: { "Content-Type": "application/json" } });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r.json();
  }
  async function postJSON<T>(url: string, data: any) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",           // 쿠키 쓰면 필요, 아니어도 무방
      body: JSON.stringify(data),
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`${r.status} ${r.statusText} - ${text}`);
    try { return JSON.parse(text) as T; } catch { throw new Error(`Invalid JSON: ${text}`); }
  }

  // --- 데이터 로딩 ---
  const loadProjects = async () => {
    setLoadingProjects(true);
    try {
      const list = await getJSON<Project[]>(`${PHP_BASE}/projects/list.php`);
      setProjects(Array.isArray(list) ? list : []);
    } catch (e) {
      console.error("projects/list.php error", e);
      setProjects([]);
    } finally {
      setLoadingProjects(false);
    }
  };

  const loadSites = async (projectId: string | "ALL") => {
    setLoadingSites(true);
    try {
      const qs = projectId !== "ALL" ? `?projectId=${encodeURIComponent(projectId)}` : "";
      const list = await getJSON<Site[]>(`${PHP_BASE}/sites/list.php${qs}`);
      setSites(Array.isArray(list) ? list : []);
    } catch (e) {
      console.error("sites/list.php error", e);
      setSites([]);
    } finally {
      setLoadingSites(false);
    }
  };

  useEffect(() => {
    void loadProjects();
  }, [PHP_BASE]);

  useEffect(() => {
    void loadSites(selectedProjectId);
  }, [PHP_BASE, selectedProjectId]);

  // --- Importer 2.0 ---
  const locateImporter = async () => {
    const pick = (await IpcApp.callIpcChannel(channelName, "openFile", {
      title: "Locate Bentley DgnDb iModel Importer 2.0",
      properties: ["openFile"],
      filters: [{ name: "Executables", extensions: ["exe"] }],
    })) as OpenDialogReturnValue;
    const exe = pick?.filePaths?.[0];
    if (!exe) return;
    await IpcApp.callIpcChannel(channelName, "setImodelImporterPath", exe);
    alert("Importer 경로가 저장되었습니다.");
  };

  const runImporterGUI = async () => {
    const ok = await IpcApp.callIpcChannel(channelName, "runImodelImporterGUI");
    if (!ok) alert("Importer 경로가 설정되지 않았습니다. 먼저 '경로 지정'을 해주세요.");
  };

  // --- 프로젝트 CRUD (admin 전용) ---
  const createProject = async () => {
    const name = await askName("새 프로젝트 이름");
    if (!name) return;
    setBusy(true);
    try {
      await postJSON(`${PHP_BASE}/projects/create.php`, { name, userId });
      await loadProjects();
      setSelectedProjectId("ALL");
    } catch (e) {
      console.error(e); alert("프로젝트 생성 실패");
    } finally { setBusy(false); }
  };

  const renameProject = async (p: Project) => {
    const name = await askName("새 프로젝트 이름", p.name);
    if (!name || name === p.name) return;
    setBusy(true);
    try {
      await postJSON(`${PHP_BASE}/projects/rename.php`, { projectId: p.id, name, userId });
      await loadProjects();
    } catch (e) {
      console.error(e); alert("프로젝트 이름 변경 실패");
    } finally { setBusy(false); }
  };

  const deleteProject = async (p: Project) => {
    if (!confirm(`프로젝트를 삭제하시겠습니까?\n${p.name}`)) return;
    setBusy(true);
    try {
      await postJSON(`${PHP_BASE}/projects/delete.php`, { projectId: p.id, userId });
      await loadProjects();
      if (selectedProjectId === p.id) setSelectedProjectId("ALL");
      await loadSites("ALL");
    } catch (e) {
      alert("프로젝트 삭제 실패");
      console.error(e);
    } finally {
      setBusy(false);
    }
  };

  // --- 사이트 CRUD (admin 전용) ---
  const createSite = async () => {
    const name = await askName("새 사이트 이름");
    if (!name) return;
    const projectId = selectedProjectId !== "ALL" ? selectedProjectId : "";
    setBusy(true);
    try {
      await postJSON(`${PHP_BASE}/sites/create.php`, { name, projectId, userId });
      await loadSites(selectedProjectId);
    } catch (e) {
      console.error(e); alert("사이트 생성 실패");
    } finally { setBusy(false); }
  };

  const renameSite = async (s: Site) => {
    const name = await askName("새 사이트 이름", s.name);
    if (!name || name === s.name) return;
    setBusy(true);
    try {
      await postJSON(`${PHP_BASE}/sites/rename.php`, { siteId: s.id, name, userId });
      await loadSites(selectedProjectId);
    } catch (e) {
      console.error(e); alert("사이트 이름 변경 실패");
    } finally { setBusy(false); }
  };

  const deleteSite = async (s: Site) => {
    if (!confirm(`사이트를 삭제하시겠습니까?\n${s.name}`)) return;
    setBusy(true);
    try {
      await postJSON(`${PHP_BASE}/sites/delete.php`, { siteId: s.id, userId });
      await loadSites(selectedProjectId);
    } catch (e) {
      alert("사이트 삭제 실패");
      console.error(e);
    } finally {
      setBusy(false);
    }
  };

  // 글로벌 업로드(사이트/프로젝트 무관)
  const uploadSnapshotGlobal = async () => {
    fileRef.current?.click();
    fileRef.current!.onchange = async (ev: any) => {
      const f: File | undefined = ev.target.files?.[0];
      fileRef.current!.onchange = null;
      fileRef.current!.value = "";
      if (!f) return;

      const name = await askName("스냅샷 표시 이름(생략 가능)", f.name);
      const displayName = name || f.name;

      setBusy(true);
      try {
        const res = await Api.uploadSnapshotGlobal(f, displayName);
        console.log("upload response", res);
        if (!res?.success) { alert(`업로드 실패: ${res?.message || "서버 에러"}`); return; }
        alert("업로드 완료");
        await loadSites(selectedProjectId); // 필요시 화면 갱신
      } catch (e) {
        console.error(e); alert("업로드 중 오류");
      } finally { setBusy(false); }
    };
  };

  // --- 렌더 ---
  return (
    <div style={{ padding: 16, height: "100%", display: "flex", flexDirection: "column", gap: 12 }}>
      <header style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <h2 style={{ margin: 0, flex: 1 }}>Projects & Sites</h2>
        <button onClick={locateImporter}>Importer 2.0 경로 지정…</button>
        <button onClick={runImporterGUI}>Importer 2.0 실행(GUI)…</button>

        {isAdmin}
        <button disabled={busy} onClick={uploadSnapshotGlobal}>스냅샷 업로드(서버)…</button>

        {isAdmin && (
          <>
            <span style={{ opacity: 0.4, margin: "0 6px" }}>|</span>
            <button disabled={busy} onClick={createProject}>프로젝트 추가</button>
            <button disabled={busy} onClick={createSite}>사이트 추가</button>
          </>
        )}
      </header>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(260px, 1fr) 2fr",
          gap: 12,
          minHeight: 0,
          flex: 1,
        }}
      >
        {/* Projects */}
        <section style={{ border: "1px solid #333", borderRadius: 8, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "10px 12px", borderBottom: "1px solid #333", display: "flex", alignItems: "center" }}>
            <strong style={{ flex: 1 }}>Projects</strong>
            <button
              style={{
                fontSize: 12,
                padding: "2px 8px",
                opacity: selectedProjectId === "ALL" ? 0.7 : 1,
              }}
              onClick={() => setSelectedProjectId("ALL")}
              title="모든 사이트 보기"
            >
              ALL
            </button>
          </div>

          <div style={{ padding: 8, overflow: "auto" }}>
            {loadingProjects ? (
              <div>Loading projects…</div>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {projects.map((p) => {
                  const sel = selectedProjectId === p.id;
                  return (
                    <li
                      key={p.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "8px 10px",
                        border: "1px solid " + (sel ? "#6cf" : "#333"),
                        borderRadius: 8,
                        marginBottom: 8,
                        background: sel ? "rgba(100,200,255,0.06)" : "transparent",
                      }}
                    >
                      <div
                        onClick={() => setSelectedProjectId(p.id)}
                        style={{ cursor: "pointer", flex: 1, fontWeight: 600 }}
                        title="이 프로젝트의 사이트 보기"
                      >
                        {p.name}
                      </div>
                      {isAdmin && (
                        <>
                          <button onClick={() => renameProject(p)}>이름변경</button>
                          <button onClick={() => deleteProject(p)}>삭제</button>
                        </>
                      )}
                    </li>
                  );
                })}
                {!projects.length && <li style={{ opacity: 0.7 }}>프로젝트가 없습니다.</li>}
              </ul>
            )}
          </div>
        </section>

        {/* Sites */}
        <section style={{ border: "1px solid #333", borderRadius: 8, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "10px 12px", borderBottom: "1px solid #333" }}>
            <strong>Sites {selectedProjectId !== "ALL" ? `(Project: ${projects.find(p => p.id === selectedProjectId)?.name || ""})` : "(ALL)"}</strong>
          </div>

          <div style={{ padding: 8, overflow: "auto" }}>
            {loadingSites ? (
              <div>Loading sites…</div>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {sites.map((s) => (
                  <li
                    key={s.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr auto",
                      alignItems: "center",
                      gap: 8,
                      padding: "8px 10px",
                      border: "1px solid #333",
                      borderRadius: 8,
                      marginBottom: 8,
                    }}
                  >
                    <div
                      onClick={() => onOpenSite({ siteId: s.id, siteName: s.name })}
                      style={{ cursor: "pointer" }}
                      title="클릭하면 뷰어로 이동 (모델은 아직 로드하지 않음)"
                    >
                      <div style={{ fontWeight: 700 }}>{s.name}</div>
                      <div style={{ color: "#888", fontSize: 12 }}>
                        {s.snapshotUrl
                          ? <small style={{opacity:.7}}>최근 스냅샷: {s.snapshotUrl.split("/").pop()}</small>
                          : <small style={{opacity:.5}}>최근 스냅샷 없음</small>
                        }
                      </div>
                    </div>

                    {isAdmin && (
                      <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={() => renameSite(s)}>이름변경</button>
                        <button onClick={() => deleteSite(s)}>삭제</button>
                      </div>
                    )}
                  </li>
                ))}
                {!sites.length && <li style={{ opacity: 0.7 }}>사이트가 없습니다.</li>}
              </ul>
            )}
          </div>
        </section>
      </div>

      {/* 숨김 파일 입력(추후 업로드 기능에 사용) */}
      <input ref={fileRef} type="file" style={{ display: "none" }} />
      <div style={{ color: "#889", fontSize: 12 }}>
        PHP: {PHP_BASE} · 사용자: {userId} · 권한: {isAdmin ? "admin" : "user"}
      </div>
      <NameDialog
        open={nameDlgOpen}
        title={nameDlgTitle}
        initial={nameDlgInitial}
        onCancel={() => {
          setNameDlgOpen(false);
          nameDlgResolveRef.current?.(null);
          nameDlgResolveRef.current = null;
        }}
        onSubmit={(val) => {
          setNameDlgOpen(false);
          nameDlgResolveRef.current?.(val);
          nameDlgResolveRef.current = null;
        }}
      />
    </div>
  );
}