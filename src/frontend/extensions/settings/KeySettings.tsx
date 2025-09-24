// src/frontend/extensions/settings/KeySettings.tsx
import React from "react";
import { IModelApp, EmphasizeElements, ScreenViewport } from "@itwin/core-frontend";
import { ViewFlags, RenderMode } from "@itwin/core-common";

// ───────── props ─────────
export type KeySettingsProps = {
  /** 계정 식별용 키 (이메일/사용자ID 등). 주지 않으면 "default" 네임스페이스를 사용 */
  accountKey?: string;
};

// ───────── 유틸 ─────────
function getSelectedView(): ScreenViewport | undefined {
  return IModelApp.viewManager.selectedView;
}
function getSelectedElementIds(): string[] {
  const vp = getSelectedView();
  if (!vp) return [];
  return Array.from(vp.iModel.selectionSet.elements);
}
function toggleViewFlags(partial: Partial<ViewFlags>) {
  const vp = getSelectedView();
  if (!vp) return;
  const next = vp.viewFlags.copy(partial);
  vp.viewFlags = next;
  vp.invalidateRenderPlan();
}
function fitView() {
  if (!IModelApp.tools.run || !IModelApp.tools.run("View.Fit")) {
    const vp = getSelectedView();
    vp?.zoomToElements(vp!.iModel.selectionSet.elements, { animateFrustumChange: true });
  }
}
function zoomToSelected() {
  const vp = getSelectedView();
  if (!vp) return;
  const ids = getSelectedElementIds();
  if (ids.length === 0) return;
  vp.zoomToElements(vp.iModel.selectionSet.elements, { animateFrustumChange: true });
}

// RenderMode 순환
const RENDER_ORDER: RenderMode[] = [
  RenderMode.SmoothShade,
  RenderMode.HiddenLine,
  RenderMode.SolidFill,
  RenderMode.Wireframe,
];
function cycleRenderMode() {
  const vp = getSelectedView();
  if (!vp) return;
  const cur = vp.viewFlags.renderMode;
  const idx = RENDER_ORDER.indexOf(cur);
  const next = RENDER_ORDER[(idx + 1) % RENDER_ORDER.length];
  const vf = vp.viewFlags.copy({ renderMode: next });
  vp.viewFlags = vf;
  vp.invalidateRenderPlan();
}

// ───────── 액션들 ─────────
function runHideSelection() {
  const vp = getSelectedView();
  if (!vp) return;
  const ids = getSelectedElementIds();
  if (ids.length === 0) return;
  const emph = EmphasizeElements.getOrCreate(vp);
  emph.hideElements(ids, vp);
  vp.invalidateRenderPlan();
}
function runIsolateSelection() {
  const vp = getSelectedView();
  if (!vp) return;
  const ids = getSelectedElementIds();
  if (ids.length === 0) return;
  const emph = EmphasizeElements.getOrCreate(vp);
  emph.isolateElements(ids, vp);
  vp.invalidateRenderPlan();
}
function runUnhideAll() {
  const vp = getSelectedView();
  if (!vp) return;
  EmphasizeElements.clear(vp);
  vp.invalidateRenderPlan();
}

function toggleShadows() { const vp = getSelectedView(); if (!vp) return; toggleViewFlags({ shadows: !vp.viewFlags.shadows }); }
function toggleAO() { const vp = getSelectedView(); if (!vp) return; toggleViewFlags({ ambientOcclusion: !vp.viewFlags.ambientOcclusion }); }
function toggleEdges() { const vp = getSelectedView(); if (!vp) return; toggleViewFlags({ visibleEdges: !vp.viewFlags.visibleEdges }); }
function toggleBackgroundMap() { const vp = getSelectedView(); if (!vp) return; toggleViewFlags({ backgroundMap: !vp.viewFlags.backgroundMap }); }
function applySafePreset() {
  const vp = getSelectedView(); if (!vp) return;
  const next = vp.viewFlags.copy({ shadows:false, ambientOcclusion:false, visibleEdges:false, transparency:true, backgroundMap:false });
  vp.viewFlags = next; vp.invalidateRenderPlan();
}
function applyQualityPreset() {
  const vp = getSelectedView(); if (!vp) return;
  const next = vp.viewFlags.copy({ shadows:true, ambientOcclusion:true, visibleEdges:true, transparency:true, backgroundMap:vp.viewFlags.backgroundMap });
  vp.viewFlags = next; vp.invalidateRenderPlan();
}

// ───────── 액션 레지스트리 ─────────
type ActionItem = { id: string; label: string; run: () => void; category: "Selection" | "View" | "Render" | "Presets" };
const ACTIONS: ActionItem[] = [
  // Selection
  { id: "hide",    label: "Hide Selection",      run: runHideSelection,    category: "Selection" },
  { id: "isolate", label: "Isolate Selection",   run: runIsolateSelection, category: "Selection" },
  { id: "unhide",  label: "Unhide All",          run: runUnhideAll,        category: "Selection" },

  // View
  { id: "fit",     label: "Fit View",            run: fitView,             category: "View" },
  { id: "zoomSel", label: "Zoom to Selection",   run: zoomToSelected,      category: "View" },

  // Render
  { id: "renderCycle", label: "Cycle Render Mode", run: cycleRenderMode,   category: "Render" },
  { id: "shadows",     label: "Toggle Shadows",    run: toggleShadows,     category: "Render" },
  { id: "ao",          label: "Toggle SSAO",       run: toggleAO,          category: "Render" },
  { id: "edges",       label: "Toggle Edges",      run: toggleEdges,       category: "Render" },
  { id: "bgmap",       label: "Toggle Background Map", run: toggleBackgroundMap, category: "Render" },

  // Presets
  { id: "presetSafe",    label: "Apply Preset: Safe (Heavy)", run: applySafePreset,    category: "Presets" },
  { id: "presetQuality", label: "Apply Preset: Quality",      run: applyQualityPreset, category: "Presets" },
];

// ───────── 단축키 포맷/매칭 ─────────
type KeyMap = Record<string, string>;
const STORAGE_NS = "itwin.keybindings.v2";
const MOD_KEYS = ["ctrl", "shift", "alt", "meta"] as const;

function comboFromEvent(e: KeyboardEvent | React.KeyboardEvent<HTMLInputElement>): string {
  const parts: string[] = [];
  if ("ctrlKey" in e && e.ctrlKey) parts.push("ctrl");
  if ("shiftKey" in e && e.shiftKey) parts.push("shift");
  if ("altKey" in e && e.altKey) parts.push("alt");
  // @ts-ignore
  if (e.metaKey) parts.push("meta");
  let key = (e as any).key as string | undefined;
  if (!key) return parts.join("+");
  key = key.toLowerCase();
  if (["control", "shift", "alt", "meta"].includes(key)) return parts.join("+");
  if (key === " ") key = "space";
  if (key === "escape") key = "esc";
  parts.push(key);
  return parts.join("+");
}
function prettyCombo(s: string): string {
  if (!s) return "";
  return s.split("+").map((p) => {
    const t = p.toLowerCase();
    if (t === "ctrl") return "Ctrl";
    if (t === "shift") return "Shift";
    if (t === "alt") return "Alt";
    if (t === "meta") return "Cmd";
    if (t === "esc") return "Esc";
    if (t.startsWith("f") && /^\d+$/.test(t.slice(1))) return t.toUpperCase();
    if (t.length === 1) return t.toUpperCase();
    return t.charAt(0).toUpperCase() + t.slice(1);
  }).join("+");
}
function matchesCombo(binding: string, e: KeyboardEvent): boolean {
  const want = binding.toLowerCase().split("+").filter(Boolean);
  const got  = comboFromEvent(e).toLowerCase().split("+").filter(Boolean);
  return want.join("+") === got.join("+");
}

// ───────── 저장/로드(+ 계정 네임스페이스) ─────────
function storageKeyFor(accountKey: string) {
  return `${STORAGE_NS}::${accountKey || "default"}`;
}
function loadKeys(accountKey: string): KeyMap {
  try {
    const raw = localStorage.getItem(storageKeyFor(accountKey));
    if (raw) return JSON.parse(raw);
  } catch {}
  // 기본 바인딩
  return {
    // Selection
    hide: "h",
    isolate: "i",
    unhide: "u",
    // View
    fit: "f",
    zoomSel: "shift+f",
    // Render
    renderCycle: "ctrl+shift+r",
    shadows: "ctrl+shift+s",
    ao: "ctrl+shift+a",
    edges: "ctrl+shift+e",
    bgmap: "ctrl+shift+b",
    // Presets
    presetSafe: "ctrl+1",
    presetQuality: "ctrl+2",
  };
}
function saveKeys(accountKey: string, keys: KeyMap) {
  localStorage.setItem(storageKeyFor(accountKey), JSON.stringify(keys));
}

// ───────── 파일 Import/Export ─────────
function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
async function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ""));
    fr.onerror = reject;
    fr.readAsText(file, "utf-8");
  });
}

// ───────── 컴포넌트 ─────────
export default function KeySettings(props: KeySettingsProps) {
  const accountKey = (props.accountKey || "default").toLowerCase();
  const [keys, setKeys] = React.useState<KeyMap>(() => loadKeys(accountKey));
  const [lastLoadedFor, setLastLoadedFor] = React.useState(accountKey);
  const [importErr, setImportErr] = React.useState<string | null>(null);

  // 계정키 바뀌면 해당 계정의 키맵 자동 로드
  React.useEffect(() => {
    if (lastLoadedFor !== accountKey) {
      setKeys(loadKeys(accountKey));
      setLastLoadedFor(accountKey);
    }
  }, [accountKey, lastLoadedFor]);

  // 변경 시 저장
  React.useEffect(() => {
    saveKeys(accountKey, keys);
  }, [accountKey, keys]);

  // 전역 단축키
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      for (const a of ACTIONS) {
        const bind = keys[a.id];
        if (!bind) continue;
        if (matchesCombo(bind, e)) {
          e.preventDefault();
          a.run();
          break;
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [keys]);

  // 입력 바인딩
  const MOD_KEYS = ["ctrl", "shift", "alt", "meta"] as const;
  const bindInput = (actionId: string) => ({
    value: prettyCombo(keys[actionId] || ""),
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
      e.preventDefault();
      const combo = comboFromEvent(e);
      const parts = combo.split("+").filter(Boolean);
      const hasNonMod = parts.some((p) => !MOD_KEYS.includes(p as any));
      if (!hasNonMod) return;
      setKeys((prev) => ({ ...prev, [actionId]: combo }));
    },
    onChange: () => {},
    placeholder: "Press keys",
    style: { width: 220, fontFamily: "monospace" },
  });

  // Export/Import
  const doExport = () => {
    const fname = `keybindings_${accountKey}.json`;
    downloadJson(fname, { accountKey, bindings: keys, version: 2 });
  };
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const doImportClick = () => fileInputRef.current?.click();
  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setImportErr(null);
    const file = e.target.files?.[0];
    e.target.value = ""; // 같은 파일 연속선택 허용
    if (!file) return;
    try {
      const text = await readFileAsText(file);
      const data = JSON.parse(text);
      const imported = (data && (data.bindings || data)) as KeyMap;
      if (!imported || typeof imported !== "object") throw new Error("Invalid file");
      setKeys(imported);
    } catch (err: any) {
      setImportErr(err?.message || String(err));
    }
  };

  const hasView = !!getSelectedView();

  // 카테고리 표시
  const CATEGORY_ORDER: ActionItem["category"][] = ["Selection", "View", "Render", "Presets"];
  const groups = CATEGORY_ORDER.map((cat) => ({ cat, items: ACTIONS.filter((a) => a.category === cat) }));

  return (
    <div style={{ color: "#ddd" }}>
      <h4 style={{ margin: "0 0 8px" }}>Key bindings</h4>
      <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 10 }}>
        계정: <b>{accountKey}</b> — 이 계정 이름으로 로컬에 저장됩니다. (다른 PC에서 <i>Export/Import</i>로 이동 가능)
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button onClick={() => setKeys(loadKeys(accountKey))}>기본값으로</button>
        <button onClick={() => setKeys({})}>모두 해제</button>
        <div style={{ flex: 1 }} />
        <button onClick={doExport}>Export JSON</button>
        <input ref={fileInputRef} type="file" accept="application/json" style={{ display: "none" }} onChange={onImportFile} />
        <button onClick={doImportClick}>Import JSON</button>
      </div>
      {importErr && <div style={{ color: "#ff8080", fontSize: 12, marginBottom: 8 }}>Import 실패: {importErr}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 240px 1fr", gap: 8, alignItems: "center" }}>
        {groups.map(({ cat, items }, gi) => (
          <React.Fragment key={cat}>
            {gi > 0 && (
              <div style={{ gridColumn: "1 / -1", margin: "8px 0" }}>
                <hr style={{ borderColor: "#333" }} />
              </div>
            )}
            <div style={{ gridColumn: "1 / -1", fontWeight: 600, opacity: 0.9, margin: "4px 0 2px" }}>
              {cat}
            </div>
            {items.map((a) => (
              <React.Fragment key={a.id}>
                <div>{a.label}</div>
                <input {...bindInput(a.id)} />
                <button onClick={a.run} disabled={!hasView}>실행</button>
              </React.Fragment>
            ))}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}