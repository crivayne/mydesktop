// src/types/global.d.ts
import type { IpcRenderer } from "electron";

export {};
declare global {
  interface Window {
    desktop: { pickSnapshot: () => Promise<string | null> };

        // ✅ preload.ts에서 expose한 ipcRenderer 브릿지
    electron?: {
      ipcRenderer: IpcRenderer;
    };  
  }
}