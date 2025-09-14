/*---------------------------------------------------------------------------------------------
 * Copyright (c) Bentley Systems, Incorporated. All rights reserved.
 * See LICENSE.md in the project root for license terms and full copyright notice.
 *--------------------------------------------------------------------------------------------*/

import { ElectronHost } from "@itwin/core-electron/lib/cjs/ElectronBackend";
import { IModelHost, IpcHandler } from "@itwin/core-backend";
import { InternetConnectivityStatus } from "@itwin/core-common";
import { ElectronMainAuthorization } from "@itwin/electron-authorization/Main";
import {
  dialog, 
  Menu,
  shell,
  type OpenDialogOptions,
  type OpenDialogReturnValue,
  type SaveDialogOptions,
  type SaveDialogReturnValue
} from "electron";
import * as minimist from "minimist";
import { existsSync } from "node:fs";

import {
  channelName,
  type ViewerConfig,
  type ViewerFile,
  type ViewerIpc,
  type ViewerSettings,
} from "../common/ViewerConfig";
import { getAppEnvVar } from "./AppInfo";
import UserSettings from "./UserSettings";

import { spawn } from "node:child_process";
import * as path from "node:path";

class ViewerHandler extends IpcHandler implements ViewerIpc {
  private static _authInitialized = false;

  public get channelName() {
    return channelName;
  }
  /**
   * create the config object to send to the frontend
   * @returns Promise<ViewerConfig>
   */
  public async getConfig(): Promise<ViewerConfig> {
    const parsedArgs = minimist(process.argv.slice(2)); // first two arguments are .exe name and the path to ViewerMain.js. Skip them.
    return {
      snapshotName: parsedArgs._[0] ?? getAppEnvVar("SNAPSHOT"),
      clientId: getAppEnvVar("CLIENT_ID") ?? "",
      redirectUri: getAppEnvVar("REDIRECT_URI") ?? "",
      issuerUrl: getAppEnvVar("ISSUER_URL"),
    };
  }
  /**
   * Open file dialog
   * @param options
   * @returns
   */
  public async openFile(
    options: OpenDialogOptions
  ): Promise<OpenDialogReturnValue> {
    return dialog.showOpenDialog(options);
  }

  /**
   * Save file dialog
   * @param options
   * @returns
   */
  public async saveFile(
    options: SaveDialogOptions
  ): Promise<SaveDialogReturnValue> {
    return dialog.showSaveDialog(options);
  }

  /**
   * Get user settings
   * @returns ViewerSettings
   */
  public async getSettings(): Promise<ViewerSettings> {
    return UserSettings.settings;
  }

  /**
   * Add a recent file
   * @param file
   */
  public async addRecentFile(file: ViewerFile): Promise<void> {
    UserSettings.addRecent(file);
  }

  /**
   * Remove file from recent settings
   * @param file
   */
  public async removeRecentFile(file: ViewerFile): Promise<void> {
    UserSettings.removeRecent(file);
  }

  /**
   * Check if file exists in the given path, returns false if path is blank
   * @param file
   */
  public async checkFileExists(file: ViewerFile): Promise<boolean> {
    return file.path ? existsSync(file.path) : false;
  }

  /**
   * Changes due to connectivity status
   * @param connectivityStatus
   */
  public async setConnectivity() : Promise<void> {
    // 완전 오프라인: 다운로드 메뉴 비활성
    const downloadMenuItem = Menu.getApplicationMenu()?.getMenuItemById("download-menu-item");
    if (downloadMenuItem) downloadMenuItem.enabled = false;
    // 인증 초기화 스킵
    return;
  }

  /** 외부 URL 열기 (스냅샷 앱 다운로드 페이지 등) */
  public async openUrl(url: string): Promise<void> {
    await shell.openExternal(url);
  }

  /** Importer 2.0 경로 저장 */
  public async setImodelImporterPath(exePath: string): Promise<void> {
    UserSettings.setImodelImporterPath(exePath);
  }

  /** Importer 2.0 GUI 실행 (인자 없이 실행) */
  public async runImodelImporterGUI(exePath?: string): Promise<boolean> {
    const p = exePath ?? UserSettings.imodelImporterPath;
    if (!p || !existsSync(p)) return false;
    const child = spawn(p, [], { detached: true, stdio: "inherit" });
    child.unref();
    return true;
  }

  /** Importer 2.0 CLI 실행
   * @param args  - IDgnToIDgnDb.exe 인자 (예: ["-i", in.i.dgn, "-z", out.imodel, "--output", out.ibim, "--imodelVersion", "2.0"])
   * @param cwd   - 실행 작업 폴더(로그/임시파일 관리에 유용)
   */
  public async runImodelImporterCLI(
    args: string[],
    cwd?: string
  ): Promise<{ ok: boolean; exitCode: number | null }> {
    const exe = UserSettings.imodelImporterPath;
    if (!exe || !existsSync(exe)) return { ok: false, exitCode: null };

    return await new Promise((resolve) => {
      const child = spawn(exe, args, {
        cwd,
        stdio: "inherit",
        env: {
          ...process.env,
          // 매뉴얼: 로깅 활성화
          BENTLEY_DGNDBIMPORTER_LOGGING_ENABLE: "1",
          // 필요 시: BENTLEY_DGNDBIMPORTER_LOGGING_CONFIG: "C:\\Program Files\\Bentley\\DgnV8Converter 2.0\\logging.config.xml",
        },
      });
      child.on("exit", (code) => resolve({ ok: code === 0, exitCode: code ?? null }));
      child.on("error", () => resolve({ ok: false, exitCode: null }));
    });
  }

  public async openDirectory(): Promise<OpenDialogReturnValue> {
    return dialog.showOpenDialog({
      title: "Select output folder",
      properties: ["openDirectory", "createDirectory"], // 폴더 선택 + 없으면 생성
    });
  }

  // 스냅샷 폴더 가져오기/설정
  public async getSnapshotDir(): Promise<string> {
    return UserSettings.getSnapshotDir();
  }

  public async setSnapshotDir(dir: string): Promise<void> {
    UserSettings.setSnapshotDir(dir);
  }

  // 상단메뉴 노출설정
  public async setMenuVisible(visible: boolean): Promise<void> {
  ElectronHost.mainWindow?.setMenuBarVisibility(visible);
  }
}

export default ViewerHandler;
