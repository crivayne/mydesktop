/*---------------------------------------------------------------------------------------------
 * Copyright (c) Bentley Systems, Incorporated. All rights reserved.
 * See LICENSE.md in the project root for license terms and full copyright notice.
 *--------------------------------------------------------------------------------------------*/

// src/frontend/components/home/Home.tsx
// src/frontend/components/home/Home.tsx
import "./Home.scss";
import { useNavigate } from "react-router-dom";
import { IpcApp } from "@itwin/core-frontend";
import { channelName } from "../../../common/ViewerConfig"; // 상대 경로 주의

type OpenDialogReturnValue = {
  canceled: boolean;
  filePaths: string[];
};


export default function Home() {
  const nav = useNavigate();

  const openSnapshot = async () => {
    // 백엔드 IPC(이미 구현됨: ViewerHandler.openFile) 호출
    const result = await IpcApp.callIpcChannel(
      channelName,
      "openFile",
      {
        title: "Open iModel Snapshot",
        properties: ["openFile"],
        filters: [{ name: "iModel Snapshot", extensions: ["bim", "ibim", "imodel"] }],
      }
    ) as OpenDialogReturnValue;

    if (!result || result.canceled || result.filePaths.length === 0) return;

    const file = result.filePaths[0];
    nav("/viewer", { state: { filePath: file } });
  };

  // 1) Importer 경로 지정
  const locateImporter = async () => {
    const pick = await IpcApp.callIpcChannel(channelName, "openFile", {
      title: "Locate Bentley DgnDb iModel Importer 2.0",
      properties: ["openFile"],
      // Windows 기준 예시: exe
      filters: [{ name: "Executables", extensions: ["exe"] }],
    }) as OpenDialogReturnValue;

    const exe = pick?.filePaths?.[0];
    if (!exe) return;
    await IpcApp.callIpcChannel(channelName, "setImodelImporterPath", exe);
    alert("Importer 경로가 저장되었습니다.");
  };

  // 2) Importer GUI 실행
  const runImporterGUI = async () => {
    const ok = await IpcApp.callIpcChannel(channelName, "runImodelImporterGUI");
    if (!ok) alert("Importer 경로가 설정되지 않았습니다. 먼저 '경로 지정'을 해주세요.");
  };

  // 3) (선택) 빠른 변환: .i.dgn → .imodel/.ibim
  const quickConvert = async () => {
    // (a) 입력 파일(.i.dgn) 선택
    const sel = await IpcApp.callIpcChannel(channelName, "openFile", {
      title: "Select .i.dgn file(s)",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "i-model package (.i.dgn)", extensions: ["i.dgn"] }],
    }) as OpenDialogReturnValue;
    const inputs = sel?.filePaths ?? [];
    if (!inputs.length) return;

    // (b) 출력 폴더 선택
    const out = await IpcApp.callIpcChannel(channelName, "openDirectory") as OpenDialogReturnValue;
    const outDir = out?.filePaths?.[0];
    if (!outDir) return;

    // (c) (선택) ImportConfig.xml 사용할지 여부
    const useConfig = confirm("ImportConfig.xml을 사용할까요? (확인: 사용 / 취소: 기본)");
    const configPath = useConfig ? "C:\\Program Files\\Bentley\\DgnV8Converter 2.0\\Assets\\ImportConfig.xml" : undefined;

    for (const input of inputs) {
      const base = input.replace(/\.i\.dgn$/i, "").split(/[\\/]/).pop() as string;
      const outImodel = `${outDir}\\${base}.imodel`;
      const outIbim   = `${outDir}\\${base}.ibim`;

      // 매뉴얼 스펙: -i, -z, --output, --imodelVersion 2.0 (+ --config 선택)
      const args = [
        "-i", input,
        "-z", outImodel,
        "--output", outIbim,
        "--imodelVersion", "2.0",
      ];
      if (configPath) {
        args.push("--config", configPath);
      }

      const res = await IpcApp.callIpcChannel(
        channelName,
        "runImodelImporterCLI",
        args,
        outDir               // ← 작업 디렉터리(cwd)
      ) as { ok: boolean; exitCode: number | null };

      if (!res?.ok) {
        alert(`변환 실패:\n${input}\nexitCode=${res?.exitCode ?? "unknown"}\nImporter의 --help / 로그를 확인하세요.`);
        return; // 한 건 실패 시 중단
      }
    }

    alert("변환 완료! Open Snapshot으로 생성된 .imodel / .ibim 파일을 여세요.\n(참고: %LOCALAPPDATA%\\Bentley\\Logs 에 상세 로그)");
  };

  return (
    <div className="home-root" style={{ padding: 24 }}>
      <h2>Local iModel Desktop</h2>

      <section style={{ marginBottom: 24 }}>
        <h3>📂 Open Snapshot (.bim / .ibim / .imodel)</h3>
        <button onClick={openSnapshot}>Open Snapshot…</button>
      </section>

      <section>
        <h3>🛠️ Convert .i.dgn → .imodel/.ibim (with iModel Importer 2.0)</h3>
        <ol>
          <li><button onClick={locateImporter}>Importer 2.0 경로 지정…</button></li>
          <li><button onClick={runImporterGUI}>Importer 2.0 실행 (GUI)…</button></li>
          <li><button onClick={quickConvert}>빠른 변환 실행 (CLI)…</button></li>
        </ol>
        <div style={{ color: "#888", fontSize: 12 }}>
          * CLI 옵션/동작은 Importer 버전에 따라 다를 수 있습니다. 실패하면 GUI 실행으로 진행하세요.<br/>
          * 레퍼런스/외부 참조는 패키징(.i.dgn) 단계에서 포함하는 것이 안전합니다.
        </div>
      </section>
    </div>
  );
}