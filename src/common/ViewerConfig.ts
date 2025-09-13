/*---------------------------------------------------------------------------------------------
 * Copyright (c) Bentley Systems, Incorporated. All rights reserved.
 * See LICENSE.md in the project root for license terms and full copyright notice.
 *--------------------------------------------------------------------------------------------*/

import {
  IModelReadRpcInterface,
  IModelTileRpcInterface,
  type InternetConnectivityStatus,
  iTwinChannel,
  SnapshotIModelRpcInterface,
} from "@itwin/core-common";
import { PresentationRpcInterface } from "@itwin/presentation-common";
import type {
  OpenDialogOptions,
  OpenDialogReturnValue,
  SaveDialogOptions,
  SaveDialogReturnValue,
} from "electron";
import { ECSchemaRpcInterface } from "@itwin/ecschema-rpcinterface-common";

export const channelName = iTwinChannel("desktop-viewer");

export interface ViewerIpc {
  getConfig: () => Promise<ViewerConfig>;
  openFile: (options: OpenDialogOptions) => Promise<OpenDialogReturnValue>;
  getSettings: () => Promise<ViewerSettings>;
  addRecentFile: (file: ViewerFile) => Promise<void>;
  removeRecentFile: (file: ViewerFile) => Promise<void>;
  checkFileExists: (file: ViewerFile) => Promise<boolean>;
  saveFile: (options: SaveDialogOptions) => Promise<SaveDialogReturnValue>;
  setConnectivity: (
    connectivityStatus: InternetConnectivityStatus
  ) => Promise<void>;

  openDirectory(): Promise<OpenDialogReturnValue>;                 // 추가

  setImodelImporterPath(exePath: string): Promise<void>;           // 추가
  runImodelImporterGUI(exePath?: string): Promise<boolean>;        // 추가
  runImodelImporterCLI(
    args: string[],
    cwd?: string
  ): Promise<{ ok: boolean; exitCode: number | null }>;            // 추가
}

export interface ViewerConfig {
  snapshotName?: string;
  clientId: string;
  redirectUri: string;
  issuerUrl?: string;
}

/** RPC interfaces required by the viewer */
export const viewerRpcs = [
  IModelReadRpcInterface,
  IModelTileRpcInterface,
  PresentationRpcInterface,
  SnapshotIModelRpcInterface,     // eslint-disable-line @typescript-eslint/no-deprecated
  ECSchemaRpcInterface
];

export interface ViewerFile {
  displayName: string;
  path: string;
  iTwinId?: string;
  iModelId?: string;
}

export interface ViewerSettings {
  defaultRecent?: boolean;
  recents?: ViewerFile[];
  imodelImporterPath?: string; // iModel importer 2.0 실행 파일 경로
}
