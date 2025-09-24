// src/frontend/services/uiBus.ts
type UiCmd = { type: "open-snapshot" | "open-reality"; payload?: any };

const bus = new EventTarget();

export function emitUi(cmd: UiCmd) {
  bus.dispatchEvent(new CustomEvent<UiCmd>("ui", { detail: cmd }));
}

export function onUi(handler: (cmd: UiCmd) => void): () => void {
  const listener = (e: Event) => {
    const ce = e as CustomEvent<UiCmd>;
    handler(ce.detail);
  };
  bus.addEventListener("ui", listener);
  // 구독해제 함수는 () => void 이어야 함
  return () => {
    bus.removeEventListener("ui", listener);
  };
}