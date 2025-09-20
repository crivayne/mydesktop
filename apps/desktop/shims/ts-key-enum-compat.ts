// ts-key-enum-compat.ts
// 👇 alias를 타지 않도록 '실제 배포 파일'을 직접 import (정확한 .js 경로)
import KeyDefault from "ts-key-enum/dist/js/Key.enum.js";

// named / default 둘 다 제공
export const Key = KeyDefault;
export default KeyDefault;
