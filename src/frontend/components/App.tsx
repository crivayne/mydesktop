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
import { useCallback, useEffect, useMemo } from "react";
import { BrowserRouter, Outlet, Route, Routes, Navigate, useNavigate, useLocation } from "react-router-dom";
import { IpcApp } from "@itwin/core-frontend";

import { viewerRpcs, channelName } from "../../common/ViewerConfig";
import { unifiedSelectionStorage } from "../../selectionStorage";
import { ITwinViewerApp } from "../app/ITwinViewerApp";
import { SettingsContextProvider } from "../services/SettingsContext";
import { ViewerRoute } from "./routes";
import LoginPanel from "../components/login/LoginPanel";
import ProjectSitePanel from "../components/projects/ProjectSitePanel";

function LoginPage() {
  const navigate = useNavigate();
  return (
    <LoginPanel
      onSuccess={({ id, apiBase, role }) => {
        // 필요하다면 간단 세션 저장
        localStorage.setItem("itwin-api-base", apiBase);
        localStorage.setItem("itwin-user-id", id);
        localStorage.setItem("itwin-user-role", role);
        // 로그인 성공 후 원래 Home으로
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
  const navigate = useNavigate();
  const userId = localStorage.getItem("itwin-user-id") || "";
  const apiBase = localStorage.getItem("itwin-api-base") || "";
  const role = (localStorage.getItem("itwin-user-role") || "user") as "admin" | "user";
  if (!userId || !apiBase) return <Navigate to="/" replace />;

  return (
    <ProjectSitePanel
      userId={userId}
      apiBase={apiBase}
      isAdmin={role === "admin"}
      onOpenSite={({ siteId, siteName }) => {
        // 모델 없이 뷰어 진입 (siteId만 전달)
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

  return (
    <ThemeProvider theme="dark" style={{ height: "100%" }}>
      {initialized ? (
        <BrowserRouter>
          <SettingsContextProvider>
            <PageLayout>
              <MenuVisibilityBridge />
              <IpcMenuBridge />   {/* 여기 추가 */}
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
          </SettingsContextProvider>
        </BrowserRouter>
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
