// apps/desktop/src/frontend/bootstrap.ts
import { IModelApp } from "@itwin/core-frontend";
import { loadElectronFrontend } from "../../shims/electron-frontend.mjs";

let started = false;

export async function ensureFrontendStarted() {
  if (started) return;

  // ⬇️ 여기서 동적으로 ElectronApp 불러오기
  const { ElectronApp } = await loadElectronFrontend();

  await ElectronApp.startup({
    iModelApp: {
      applicationVersion: "5.0.0",
    } as any,
  } as any);

  // (선택) ko 로케일 JSON 경고가 거슬리면 en으로 고정
  try {
    const loc: any = IModelApp.localization;
    if (typeof loc?.changeLanguage === "function") await loc.changeLanguage("en");
    else if (typeof loc?.setLanguage === "function") await loc.setLanguage("en");
  } catch {}

  started = true;
}