// apps/desktop/shims/electron-frontend.mjs
// ❗️정적 re-export 금지. 동적으로 읽어오게 만든다.
export async function loadElectronFrontend() {
  // CJS 모듈을 런타임에 로드 → TDZ 회피
  const mod = await import("@itwin/core-electron/lib/cjs/ElectronFrontend.js");
  return mod; // { ElectronApp, ElectronRenderer, ... }
}
