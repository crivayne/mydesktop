/*---------------------------------------------------------------------------------------------
 * Copyright (c) Bentley Systems, Incorporated. All rights reserved.
 * See LICENSE.md in the project root for license terms and full copyright notice.
 *--------------------------------------------------------------------------------------------*/

import { ElectronHost } from "@itwin/core-electron/lib/cjs/ElectronBackend";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

import type { ViewerFile, ViewerSettings } from "../common/ViewerConfig";

class UserSettings {
  private _settings: ViewerSettings;
  private _dataPath: string;

  constructor() {
    // cannot set here as we are using ElectronHost.app to obtain and it will not yet be initialized
    this._dataPath = "";
    this._settings = {};
  }

  /**
   * Write the settings.json file to user's app data directory
   */
  private _writeSettings() {
    writeFileSync(
      join(this.dataPath, "settings.json"),
      JSON.stringify(this.settings)
    );
  }

  /**
   * Generate default settings values
   */
  private defaultSettings() {
    this._settings = {
      defaultRecent: false,
      recents: [],
      imodelImporterPath: undefined,   // 추가(옵션이지만 권장)
    };
    this._writeSettings();
  }

  private findExistingFileIndex(file: ViewerFile) {
    if (this.settings.recents) {
      return this.settings.recents.findIndex(
        (existingFile) =>
          (file.path && existingFile.path === file.path) ||
          (file.iModelId &&
            existingFile.iTwinId === file.iTwinId &&
            existingFile.iModelId === file.iModelId)
      );
    }

    return -1;
  }

  public get dataPath() {
    if (!this._dataPath) {
      this._dataPath = ElectronHost.app
        .getPath("userData")
        .replace("/Electron", "/iTwin Viewer");
      if (!existsSync(this._dataPath)) {
        mkdirSync(this._dataPath);
      }
    }
    return this._dataPath;
  }

  public get settings() {
    if (Object.keys(this._settings).length === 0) {
      if (!existsSync(join(this.dataPath, "settings.json"))) {
        this.defaultSettings();
      }
      this._settings = JSON.parse(
        readFileSync(join(this.dataPath, "settings.json"), "utf8")
      ) as ViewerSettings;
    }

    // Go through the recent entries and set the file path to blank
    // if the local file doesn't exist anymore
    if (this._settings.recents) {
      for (const file of this._settings.recents) {
        if (file.path && !existsSync(file.path)) {   // ⬅️ 안전 가드 추가
          file.path = "";
        }
      }
    }

    return this._settings;
  }

  /**
   * Add a recent file entry
   * @param file
   */
  public addRecent(file: ViewerFile) {
    if (!this.settings.recents) {
      this._settings.recents = [file];
    } else {
      // remove if it already exists to keep recents unique
      const existing = this.findExistingFileIndex(file);
      let existingRecent: ViewerFile | undefined;

      // Add the correct path to the recent file entry in case the path is blank
      if (existing === 0) {
        this.settings.recents[existing].path = file.path;
      }

      if (existing > 0) {
        existingRecent = this.settings.recents[existing];
        existingRecent.path = file.path;
        this.settings.recents.splice(existing, 1);
      }

      // add to the top (if not already there)
      // use the existing file if one exists as it likely has the iTwin and iModel ids, whereas opening a local file would not
      if (existing !== 0) {
        this.settings.recents.unshift(existingRecent ?? file);
      }
    }
    this._writeSettings();
  }

  public removeRecent(file: ViewerFile) {
    if (this.settings.recents) {
      const existing = this.findExistingFileIndex(file);
      if (existing >= 0) {
        this.settings.recents[existing].path = "";
      }
      this._writeSettings();
    }
  }

  /** 외부에서 강제로 settings.json 저장이 필요할 때 호출 */
  public save() {
    this._writeSettings();
  }

  /** Importer 2.0 실행파일 경로 저장 */
  public setImodelImporterPath(p?: string) {
    this.settings.imodelImporterPath = p;
    this._writeSettings();
  }

  /** Importer 2.0 실행파일 경로 읽기 */
  public get imodelImporterPath(): string | undefined {
    return this.settings.imodelImporterPath;
  }
}

const userSettings = new UserSettings();

export default userSettings;
