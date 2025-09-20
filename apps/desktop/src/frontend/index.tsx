/*---------------------------------------------------------------------------------------------
 * Copyright (c) Bentley Systems, Incorporated. All rights reserved.
 * See LICENSE.md in the project root for license terms and full copyright notice.
 *--------------------------------------------------------------------------------------------*/

import "./index.scss";
import "@itwin/itwinui-layouts-css/styles.css";

import { Logger, LogLevel } from "@itwin/core-bentley";
import { createRoot } from "react-dom/client";
import { IModelApp } from "@itwin/core-frontend";
import { TreeWidget } from "@itwin/tree-widget-react";

import { AppLoggerCategory } from "../common/LoggerCategory";
import App from "./components/App";
import { ensureFrontendStarted } from "./bootstrap";

async function initTreeWidgetOnce() {
  // HMR 포함 중복 방지
  if ((globalThis as any).__treeWidgetInit) return;

  // IModelApp 초기화가 끝날 때까지 최대 N회 대기 (뷰어가 내부에서 startup해줌)
  for (let i = 0; i < 200; i++) {
    // @ts-ignore - v5에는 initialized 플래그가 있음
    if ((IModelApp as any).initialized && IModelApp.localization) break;
    await new Promise((r) => setTimeout(r, 25));
  }

  try {
    TreeWidget.initialize(IModelApp.localization);
    (globalThis as any).__treeWidgetInit = true;
  } catch (e) {
    console.warn("[TreeWidget] initialize 실패, 나중에 재시도합니다:", e);
  }
}

const viewerFrontendMain = async () => {
  // Setup logging immediately to pick up any logging during App.startup()
  Logger.initializeToConsole();
  Logger.setLevelDefault(LogLevel.Trace);
  Logger.setLevel(AppLoggerCategory.Frontend, LogLevel.Info);

  await ensureFrontendStarted ();
  // 🔹 트리 위젯 초기화 (한 번만)
  initTreeWidgetOnce(); // await 할 필요 없음

  // when initialization is complete, render
  const container = document.getElementById("root") as HTMLElement;
  const root = createRoot(container);

  document.documentElement.classList.add(`iui-theme-dark`);

  root.render(<App />);
};

viewerFrontendMain(); // eslint-disable-line @typescript-eslint/no-floating-promises
