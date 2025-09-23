// src/frontend/extensions/settings/KeySettings.tsx
import React from "react";
import { IModelApp, EmphasizeElements, ScreenViewport } from "@itwin/core-frontend";

type KeyMap = {
  hide: string;
  isolate: string;
  unhide: string;
};

const STORAGE_KEY = "itwin.keybindings";

function getSelectedView(): ScreenViewport | undefined {
  return IModelApp.viewManager.selectedView;
}

function getSelectedElementIds(): string[] {
  const vp = getSelectedView();
  if (!vp) return [];
  // SelectionSet.elements is a Set<string>
  return Array.from(vp.iModel.selectionSet.elements);
}

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
  const emph = EmphasizeElements.getOrCreate(vp);
  // 전체 초기화가 가장 확실
  emph.Empclear(vp);
  vp.invalidateRenderPlan();
}

function loadKeys(): KeyMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { hide: "h", isolate: "i", unhide: "u" };
}

function saveKeys(keys: KeyMap) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
}

export default function KeySettings() {
  const [keys, setKeys] = React.useState<KeyMap>(() => loadKeys());

  React.useEffect(() => {
    saveKeys(keys);
  }, [keys]);

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // 입력 필드 타이핑 중이면 무시
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable))
        return;

      const k = e.key.toLowerCase();
      if (k === (keys.hide || "").toLowerCase()) {
        e.preventDefault();
        runHideSelection();
      } else if (k === (keys.isolate || "").toLowerCase()) {
        e.preventDefault();
        runIsolateSelection();
      } else if (k === (keys.unhide || "").toLowerCase()) {
        e.preventDefault();
        runUnhideAll();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [keys]);

  const bindInput = (field: keyof KeyMap) => ({
    value: keys[field],
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
      e.preventDefault(); // 한 글자만 바인딩
      const newKey = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase(); // F1 등도 허용
      setKeys((prev) => ({ ...prev, [field]: newKey }));
    },
    onChange: () => {}, // 키다운으로만 변경
    placeholder: "press a key",
    style: { width: 120, textTransform: "uppercase" as const },
  });

  const hasView = !!getSelectedView();

  return (
    <div style={{ color: "#ddd" }}>
      <h4 style={{ margin: "0 0 8px" }}>Key bindings</h4>
      <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 10 }}>
        입력 칸에 포커스를 두고 원하는 키를 한 번 눌러 바인딩하세요. (기본: H / I / U)
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 140px 1fr", gap: 8, alignItems: "center" }}>
        <div>Hide Selection</div>
        <input {...bindInput("hide")} />
        <button onClick={runHideSelection} disabled={!hasView}>실행</button>

        <div>Isolate Selection</div>
        <input {...bindInput("isolate")} />
        <button onClick={runIsolateSelection} disabled={!hasView}>실행</button>

        <div>Unhide All</div>
        <input {...bindInput("unhide")} />
        <button onClick={runUnhideAll} disabled={!hasView}>실행</button>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button onClick={() => setKeys({ hide: "h", isolate: "i", unhide: "u" })}>기본값으로</button>
      </div>

      <div style={{ fontSize: 12, opacity: 0.75, marginTop: 10 }}>
        * 선택은 뷰어의 기본 선택 기능을 사용합니다. (선택 후 단축키 실행)
      </div>
    </div>
  );
}