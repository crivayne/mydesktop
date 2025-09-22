/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/
import React from "react"; 

import { type DesktopInitializerParams, useConnectivity , useDesktopViewerInitializer } from "@itwin/desktop-viewer-react";
import { SvgIModelLoader } from "@itwin/itwinui-illustrations-react";
import { PageLayout } from "@itwin/itwinui-layouts-react";
import { Flex, ThemeProvider } from "@itwin/itwinui-react";
import {
  MeasurementActionToolbar,
  MeasureTools,
} from "@itwin/measure-tools-react";
import { PropertyGridManager } from "@itwin/property-grid-react";
import { TreeWidget } from "@itwin/tree-widget-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BrowserRouter, Outlet, Route, Routes, Navigate, useNavigate, useLocation } from "react-router-dom";
import { IpcApp } from "@itwin/core-frontend";

import { viewerRpcs, channelName } from "../../common/ViewerConfig";
import { unifiedSelectionStorage } from "../../selectionStorage";
import { ITwinViewerApp } from "../app/ITwinViewerApp";
import { SettingsContextProvider } from "../services/SettingsContext";
import { ViewerRoute } from "./routes";
import { AuthProvider } from "../services/AuthContext";
import { useAuth } from "../services/AuthContext";
import LoginPanel from "../components/login/LoginPanel";
import ProjectSitePanel from "../components/projects/ProjectSitePanel";
import RenderSettings from "../extensions/settings/RenderSettings";

function LoginPage() {
  const navigate = useNavigate();
  const { setAuth } = useAuth();
  
  return (
    <LoginPanel
      onSuccess={({ id, apiBase, role }) => {
        // 1) 컨텍스트/스토리지에 일관된 auth 저장
        setAuth({ apiBase, userId: id, role }); 

        // (선택) 예전 키 유지가 필요하면 남겨도 OK
        localStorage.setItem("itwin-api-base", apiBase);
        localStorage.setItem("itwin-user-id", id);
        localStorage.setItem("itwin-user-role", role);

        // 2) 라우팅
        navigate("/home");
      }}
    />
  );
}

function MenuVisibilityBridge() {
  const loc = useLocation();
  React.useEffect(() => {
    // 로그인 라우트에서는 메뉴 숨김, 그 외엔 표시
    const onLogin = loc.pathname === "/";
    IpcApp.callIpcChannel(channelName, "setMenuVisible", !onLogin);
  }, [loc.pathname]);
  return null;
}

function IpcMenuBridge() {
  const navigate = useNavigate();
  React.useEffect(() => {
    const onMenu = (_evt: any, cmd: string) => {
      if (cmd === "home") {
        const authed = !!localStorage.getItem("itwin-user-id");
        navigate(authed ? "/home" : "/");
      }
    };
    // @ts-ignore
    IpcApp.addListener(channelName, onMenu);
    return () => {
      // @ts-ignore
      IpcApp.removeListener?.(channelName, onMenu);
    };
  }, [navigate]);
  return null;
}

// SitesPage를 ProjectSitePanel로 연결
const SitesPage = () => {
  const { auth } = useAuth();
  const navigate = useNavigate();
  if (!auth?.userId || !auth?.apiBase) return <Navigate to="/" replace />;

  return (
    <ProjectSitePanel
      userId={auth.userId}
      apiBase={auth.apiBase}
      isAdmin={auth.role === "admin"}
      onOpenSite={({ siteId, siteName }) => {
        // Viewer로 이동 + site 정보 저장(TopBar/Issues에서 재사용)
        localStorage.setItem("siteId", siteId);
        localStorage.setItem("siteName", siteName ?? "");
        navigate("/viewer", { state: { siteId, siteName } });
      }}
    />
  );
};

const App = () => {
  window.ITWIN_VIEWER_HOME = window.location.origin;

  const onIModelAppInit = useCallback(async () => {
    await TreeWidget.initialize();
    await PropertyGridManager.initialize();
    await MeasureTools.startup();
    MeasurementActionToolbar.setDefaultActionProvider();
  }, []);

  const desktopInitializerProps = useMemo<DesktopInitializerParams>(
    () => ({
      clientId: import.meta.env.IMJS_VIEWER_CLIENT_ID ?? "",
      rpcInterfaces: viewerRpcs,
      additionalI18nNamespaces: ["iTwinDesktopViewer"],
      enablePerformanceMonitors: true,
      selectionStorage: unifiedSelectionStorage,
      onIModelAppInit
    }),
    [onIModelAppInit]
  );

  const initialized = useDesktopViewerInitializer(desktopInitializerProps);
  const connectivityStatus = useConnectivity();

  useEffect(() => {
    if (initialized) {
      // setup connectivity events to let the backend know the status
      void ITwinViewerApp.ipcCall.setConnectivity(connectivityStatus);
    }
  }, [initialized, connectivityStatus]);

   const [showRenderSettings, setShowRenderSettings] = useState(false);

  useEffect(() => {
    if (!initialized) return;

    // 1) 백엔드 메뉴 → IPC로 들어오는 “render-settings”
    const onMenu = (_evt: any, cmd: string) => { if (cmd === "render-settings") setShowRenderSettings(true); };
    // @ts-ignore
    IpcApp.addListener(channelName, onMenu);

    // 2) 프런트 전역 커스텀 이벤트
    const onCustom = () => setShowRenderSettings(true);
    window.addEventListener("itwin:render-settings", onCustom as EventListener);

    return () => {
      // @ts-ignore
      IpcApp.removeListener?.(channelName, onMenu);
      window.removeEventListener("itwin:render-settings", onCustom as EventListener);
    };
  }, [initialized]);

  return (
    <ThemeProvider theme="dark" style={{ height: "100%" }}>
      {initialized ? (
        <AuthProvider>
          <BrowserRouter>
            <SettingsContextProvider>
              <PageLayout>
                <MenuVisibilityBridge />
                <IpcMenuBridge />
                <Routes>
                  {/* 패딩 있는 레이아웃 */}
                  <Route element={<PageLayout.Content padded><Outlet /></PageLayout.Content>}>
                    {/* 앱 시작점: 로그인 */}
                    <Route path="/" element={<LoginPage />} />
                    {/* 로그인 후: 기존 ProjectSite 화면 */}
                    <Route path="/home" element={<SitesPage />} />
                  </Route>
                  {/* 뷰어 영역 */}
                  <Route
                    element={
                      <PageLayout.Content>
                        <Outlet />
                      </PageLayout.Content>
                    }
                  >
                    <Route path="/viewer" element={<ViewerRoute />} />
                  </Route>

                  {/* 기타 경로는 로그인으로 */}
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </PageLayout>
              {/* ✅ 전역에서 항상 렌더됨: /home, /viewer 어디서든 열림 */}
              <RenderSettings open={showRenderSettings} onClose={()=>setShowRenderSettings(false)} />
            </SettingsContextProvider>
          </BrowserRouter>
        </AuthProvider>  
      ) : (
        <Flex justifyContent="center" style={{ height: "100%" }}>
          <SvgIModelLoader
            data-testid="loader-wrapper"
            style={{
              height: "64px",
              width: "64px",
            }}
          />
        </Flex>
      )}
    </ThemeProvider>
  );
};

// 작은 헬퍼: 동일한 PageLayout.Content 래핑을 재사용
function RouteLayout({ padded, children }: { padded?: boolean; children: React.ReactNode }) {
  const Content = (
    <PageLayout.Content {...(padded ? { padded: true } : {})}>
      <Outlet />
    </PageLayout.Content>
  );
  return (
    <Routes>
      <Route element={Content as any}>{children}</Route>
    </Routes>
  );
}

export default App;
