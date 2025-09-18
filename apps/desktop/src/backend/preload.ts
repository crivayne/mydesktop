import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("desktop", {
  pickSnapshot: () => ipcRenderer.invoke("pick-snapshot"),
});