/*---------------------------------------------------------------------------------------------
 * Copyright (c) Bentley Systems, Incorporated. All rights reserved.
 * See LICENSE.md in the project root for license terms and full copyright notice.
 *--------------------------------------------------------------------------------------------*/

import type { AsyncFunction } from "@itwin/core-bentley";
import type { IpcListener } from "@itwin/core-common";
import { IModelApp, IpcApp } from "@itwin/core-frontend";
import type { OpenDialogOptions, SaveDialogOptions } from "electron";
import type { NavigateFunction } from "react-router-dom";
import { TreeWidget } from "@itwin/tree-widget-react";

import { channelName, type ViewerIpc } from "../../common/ViewerConfig";

export declare type PickAsyncMethods<T> = {
  [P in keyof T]: T[P] extends AsyncFunction ? T[P] : never;
};

export class ITwinViewerApp {
  
  private static _menuListener: IpcListener | undefined;

  //중복 호출 방지용 플래그 + 초기화
  private static _widgetsInited = false;
  public static async initUiFrameworkOnce() {
    if (this._widgetsInited) return;
    try {
      // IModelApp.startup() 이후에 호출되어야 함
      await TreeWidget.initialize(IModelApp.localization);
      this._widgetsInited = true;
    } catch (e) {
      console.error("TreeWidget.initialize failed", e);
    }
  }

  private static _getFileName(iModelName?: string) {
    return iModelName ? iModelName.replace(/\s/g, "") : "Untitled";
  }

  public static ipcCall = IpcApp.makeIpcProxy<ViewerIpc>(channelName);

  public static translate(key: string | string[], options?: any): string {
    return IModelApp.localization.getLocalizedString(
      `iTwinDesktopViewer:${key}`,
      options
    );
  }

  public static async getFile(): Promise<string | undefined> {
    const options: OpenDialogOptions = {
      title: ITwinViewerApp.translate("open"),
      properties: ["openFile"],
      filters: [{ name: "iModels", extensions: ["ibim", "bim"] }],
    };
    const val = await ITwinViewerApp.ipcCall.openFile(options);

    return val.canceled || val.filePaths.length === 0
      ? undefined
      : val.filePaths[0];
  }

  public static initializeMenuListeners(
    navigate: NavigateFunction,
    addRecent: (
      path: string,
      iModelName?: string,
      iTwinId?: string,
      iModelId?: string
    ) => Promise<void>
  ) {
    if (this._menuListener) {
      // initialize only once
      return;
    }
    this._menuListener = async (sender, arg) => {
      switch (arg) {
        case "open":
          const filePath = await ITwinViewerApp.getFile();
          if (filePath) {
            void addRecent(filePath);
            navigate(`/viewer`, { state: { filePath } });
          }
          break;
        case "download":
          navigate("/itwins");
          break;
        case "home":
          navigate("/");
          break;
        case "preferences":
          alert("Coming Soon!");
          break;
      }
    };
    IpcApp.addListener(channelName, this._menuListener);
  }

  public static async saveBriefcase(
    iModelName?: string
  ): Promise<string | undefined> {
    const options: SaveDialogOptions = {
      title: ITwinViewerApp.translate("saveBriefcase"),
      defaultPath: `${this._getFileName(iModelName)}.bim`,
      filters: [{ name: "iModels", extensions: ["ibim", "bim"] }],
    };
    const val = await ITwinViewerApp.ipcCall.saveFile(options);

    return val.canceled || !val.filePath ? undefined : val.filePath;
  }
}
