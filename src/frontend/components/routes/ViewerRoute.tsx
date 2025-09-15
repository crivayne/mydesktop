/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/

import React from "react"; 
import {
  Viewer,
  ViewerContentToolsProvider,
  ViewerNavigationToolsProvider,
  ViewerStatusbarItemsProvider,
} from "@itwin/desktop-viewer-react";
import { MeasureToolsUiItemsProvider } from "@itwin/measure-tools-react";
import {
  AncestorsNavigationControls,
  CopyPropertyTextContextMenuItem,
  createPropertyGrid,
  ShowHideNullValuesSettingsMenuItem,
} from "@itwin/property-grid-react";
import {
  CategoriesTreeComponent,
  createTreeWidget,
  ModelsTreeComponent,
} from "@itwin/tree-widget-react";
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";

import { viewerRpcs, channelName } from "../../../common/ViewerConfig";
import {
  unifiedSelectionStorage,
} from "../../../selectionStorage";
import { IpcApp, IModelApp, Viewport } from "@itwin/core-frontend";
import { Api, SnapshotRow } from "../../services/api";

function PickDialog<T>(props: {
  open: boolean;
  title: string;
  items: T[];
  render: (item: T, index: number) => React.ReactNode;
  onCancel: () => void;
  onPick: (index: number) => void;
}) {
  const { open, title, items, render, onCancel, onPick } = props;
  const [idx, setIdx] = React.useState(0);
  React.useEffect(() => setIdx(0), [open]);
  if (!open) return null;
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999,
    }}>
      <div style={{ background: "#1e1e1e", border: "1px solid #333", borderRadius: 8, width: 560, maxHeight: "70vh", padding: 16, display: "flex", flexDirection: "column" }}>
        <div style={{ fontWeight: 700, marginBottom: 10 }}>{title}</div>
        <div style={{ overflow: "auto", flex: 1, border: "1px solid #333", borderRadius: 6 }}>
          {items.map((it, i) => (
            <div
              key={i}
              onClick={() => setIdx(i)}
              style={{
                padding: "8px 10px",
                borderBottom: "1px solid #2a2a2a",
                cursor: "pointer",
                background: i === idx ? "rgba(100,200,255,0.06)" : "transparent",
              }}
            >
              {render(it, i)}
            </div>
          ))}
          {!items.length && <div style={{ padding: 10, opacity: 0.7 }}>항목이 없습니다.</div>}
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 10 }}>
          <button onClick={onCancel}>취소</button>
          <button onClick={() => onPick(idx)} disabled={!items.length}>열기</button>
        </div>
      </div>
    </div>
  );
}

export interface ViewerRouteState { filePath?: string; siteId?: string; siteName?: string; }

export const ViewerRoute = () => {
  const location = useLocation();
  const [filePath, setFilePath] = useState<string>();
  const [siteId, setSiteId] = useState<string | undefined>();
  const [pickOpen, setPickOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<SnapshotRow[]>([]);
  const [snapDir, setSnapDir] = useState<string>("");
  const [pendingServerUrl, setPendingServerUrl] = useState<string | null>(null);

  // ✅ 로컬 스냅샷 폴더(.env)
  const SNAP_DIR = (import.meta as any).env?.VITE_SNAPSHOT_DIR?.toString() || "";

  // 서버 URL → 로컬 경로
  const urlToLocalPath = React.useCallback((u: string) => {
    const fname = (u || "").split("/").pop() || "";
    if (!snapDir || !fname) {
      console.warn("[Viewer] SNAP_DIR/filename missing", { snapDir, u });
      return "";
    }
    const sep = snapDir.includes("\\") ? "\\" : "/";
    const base = snapDir.replace(/[\\/]+$/, "");
    const full = `${base}${sep}${fname}`;
    console.log("[Viewer] local snapshot path =", full);
    return full;
  }, [snapDir]);

  // 스냅샷 폴더 확보: env → settings → 사용자 선택(1회 저장)
  useEffect(() => {
    (async () => {
      // 1) env
      const envDir = (import.meta as any).env?.VITE_SNAPSHOT_DIR?.toString() || "";
      if (envDir) { setSnapDir(envDir); return; }

      // 2) settings
      const saved = await IpcApp.callIpcChannel(channelName, "getSnapshotDir") as string;
      if (saved) { setSnapDir(saved); return; }

      // 3) 사용자에게 선택
      const pick: any = await IpcApp.callIpcChannel(channelName, "openDirectory", {
        title: "스냅샷 로컬 폴더 선택",
        properties: ["openDirectory"],
      });
      const dir = pick?.filePaths?.[0];
      if (dir) {
        await IpcApp.callIpcChannel(channelName, "setSnapshotDir", dir);
        setSnapDir(dir);
      } else {
        console.warn("[Viewer] snapshot dir not selected");
      }
    })();
  }, []);

  // 라우트 상태 반영 + 서버 URL이면 로컬로 치환
  useEffect(() => {
    const state = location?.state as ViewerRouteState | undefined;
    setSiteId(state?.siteId);
    if (state?.filePath) {
      // server url로 들어오는 경우도 있으니 변환 시도
      const maybeLocal = state.filePath.startsWith("/") ? urlToLocalPath(state.filePath) : state.filePath;
      if (maybeLocal) setFilePath(maybeLocal);
    } else {
      setFilePath(undefined);
    }
  }, [location?.state, urlToLocalPath]);

  // 사이트 최근 스냅샷 자동 로드
  useEffect(() => {
    (async () => {
      if (!siteId || filePath) return;
      // 🔁 사이트의 최근 스냅샷 1개만(또는 0/1개) 반환하는 엔드포인트 사용
      const snaps = await Api.listSiteSnapshots(siteId);
      const serverUrl = snaps?.[0]?.url;
      if (!serverUrl) return;

      if (!snapDir) { setPendingServerUrl(serverUrl); return; }
      const local = urlToLocalPath(serverUrl);
      if (local) setFilePath(local);
    })();
  }, [siteId, filePath, snapDir, urlToLocalPath]);

  // snapDir 준비되면 보류 처리
  useEffect(() => {
    if (!snapDir || !pendingServerUrl || filePath) return;
    const local = urlToLocalPath(pendingServerUrl);
    if (local) {
      setFilePath(local);
      setPendingServerUrl(null);
    }
  }, [snapDir, pendingServerUrl, filePath, urlToLocalPath]);

  // 메뉴 File→Open
  useEffect(() => {
    const onMenu = async (_evt: any, command: string) => {
      if (command !== "open") return;
      console.log("[File→Open] menu event");
      try {
        const snaps = await Api.listSnapshotsAll();
        console.log("[File→Open] count =", snaps?.length);
        if (!snaps?.length) { alert("서버에 등록된 스냅샷이 없습니다."); return; }
        setSnapshots(snaps);
        setPickOpen(true);
      } catch (e) {
        console.error("[File→Open] error", e);
        alert("스냅샷 목록을 불러오지 못했습니다.");
      }
    };
    // @ts-ignore
    IpcApp.addListener(channelName, onMenu);
    return () => { /* @ts-ignore */ IpcApp.removeListener?.(channelName, onMenu); };
  }, [siteId]);

  useEffect(() => {
    if (!filePath) return;

    const onOpen = (vp: Viewport) => {
      // 약간 뒤에 실행해서 뷰가 완전히 뜬 뒤 Fit
      setTimeout(() => {
        try {
          // 특정 뷰포트에 대해 Fit 실행
          void IModelApp.tools.run("View.Fit", vp);
        } catch (e) {
          console.warn("Fit failed:", e);
          // 실패시 첫 뷰포트 대상으로 한 번 더 시도
          const first = IModelApp.viewManager.getFirstOpenView();
          if (first) void IModelApp.tools.run("View.Fit", first);
        }
      }, 80);
    };
    IModelApp.viewManager.onViewOpen.addListener(onOpen);
    return () => {
      IModelApp.viewManager.onViewOpen.removeListener(onOpen);
    };
  }, [filePath]);
  
  return (
    <>
      {filePath ? (
        // ✅ 기존에 쓰던 Viewer JSX를 그대로 두세요 (수정 X)
        <Viewer
          rpcInterfaces={viewerRpcs}
          filePath={filePath}
          uiProviders={[
            new ViewerNavigationToolsProvider(),
            new ViewerContentToolsProvider({ vertical: { measureGroup: false } }),
            new ViewerStatusbarItemsProvider(),
            {
              id: "TreeWidgetUIProvider",
              getWidgets: () => [createTreeWidget({
                trees: [
                  {
                    id: ModelsTreeComponent.id,
                    getLabel: () => ModelsTreeComponent.getLabel(),
                    render: (props) => (
                      <ModelsTreeComponent
                        getSchemaContext={(iModel) => iModel.schemaContext}
                        density={props.density}
                        selectionStorage={unifiedSelectionStorage}
                        selectionMode={"extended"}
                        onPerformanceMeasured={props.onPerformanceMeasured}
                        onFeatureUsed={props.onFeatureUsed}
                      />
                    ),
                  },
                  {
                    id: CategoriesTreeComponent.id,
                    getLabel: () => CategoriesTreeComponent.getLabel(),
                    render: (props) => (
                      <CategoriesTreeComponent
                        getSchemaContext={(iModel) => iModel.schemaContext}
                        density={props.density}
                        selectionStorage={unifiedSelectionStorage}
                        onPerformanceMeasured={props.onPerformanceMeasured}
                        onFeatureUsed={props.onFeatureUsed}
                      />
                    ),
                  },
                ],
              })],
            },
            {
              id: "PropertyGridUIProvider",
              getWidgets: () => [createPropertyGrid({
                autoExpandChildCategories: true,
                ancestorsNavigationControls: (props) => (<AncestorsNavigationControls {...props} />),
                contextMenuItems: [(props) => (<CopyPropertyTextContextMenuItem {...props} />)],
                settingsMenuItems: [(props) => (<ShowHideNullValuesSettingsMenuItem {...props} persist={true} />)],
              })],
            },
            new MeasureToolsUiItemsProvider(),
          ]}
          enablePerformanceMonitors={true}
          selectionStorage={unifiedSelectionStorage}
        />
      ) : (
        // 파일이 아직 없을 때 보여줄 안내 (원래 쓰던 내용 유지/수정)
        <div style={{ padding: 24 }}>
          <h3>Viewer</h3>
          <div>현재 로드된 모델이 없습니다. 상단 메뉴의 <b>File → Open</b>을 눌러 스냅샷을 선택하세요.</div>
        </div>
      )}

      {/* ✅ 여기 "return 하단"에 PickDialog를 추가합니다 */}
      <PickDialog
        open={pickOpen}
        title="스냅샷 선택"
        items={snapshots}
        render={(s) => (
          <div>
            <div style={{ fontWeight: 700 }}>{s.name}</div>
            <div style={{ fontSize: 12, color: "#888" }}>
              {s.url}{s.siteId ? ` · site:${s.siteId}` : ""}
            </div>
          </div>
        )}
        onCancel={() => setPickOpen(false)}
        onPick={async (idx) => {
          const pick = snapshots[idx];
          setPickOpen(false);
          if (!pick) return;

          const local = urlToLocalPath(pick.url);
          if (!local) { alert("스냅샷 폴더를 먼저 설정하세요."); return; }

          setFilePath(local);

          // ✅ 최근 스냅샷 기록 (sites.snapshotUrl 갱신)
          try {
            if (siteId) {
              await Api.setSiteLastOpened(siteId, pick.url); // ← id 전달 제거
            }
            await Api.writeLog?.("open-snapshot", "site", siteId ?? "-", pick.url);
          } catch {}
        }}
      />
    </>
  );
};