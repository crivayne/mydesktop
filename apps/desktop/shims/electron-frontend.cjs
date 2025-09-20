// 최소 셰임: ElectronApp 이름으로 NativeApp을 내보냅니다.
// @itwin/desktop-viewer-react 가 ElectronApp.startup 정도만 쓰는 경우 충분합니다.
const { NativeApp } = require("@itwin/core-frontend");
exports.ElectronApp = NativeApp;