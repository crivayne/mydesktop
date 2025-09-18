// src/types/global.d.ts
export {};
declare global {
  interface Window {
    desktop: { pickSnapshot: () => Promise<string | null> };
  }
}