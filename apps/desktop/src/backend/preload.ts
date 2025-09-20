import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("desktop", {
  pickSnapshot: () => ipcRenderer.invoke("pick-snapshot"),
});

// ✅ IpcApp.startup 에 넘길 ipcRenderer 브릿지도 노출
contextBridge.exposeInMainWorld("electron", {
  ipcRenderer, // 프론트에서 window.electron.ipcRenderer 로 접근
});