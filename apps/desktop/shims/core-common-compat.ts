// apps/desktop/shims/core-common-compat.ts
// 1) 진짜 ESM 엔트리에서 모든 걸 재수출
export * from "@itwin/core-common/lib/esm/core-common.js";

// 2) 번들러가 확실히 추적하도록 필요한 심볼은 명시 재수출
export { Code, RelatedElement } from "@itwin/core-common/lib/esm/core-common.js";

// 3) 트리 위젯이 잘못 core-common에서 찾는 심볼을 core-bentley에서 제공
export { BentleyError, BentleyStatus } from "@itwin/core-bentley";