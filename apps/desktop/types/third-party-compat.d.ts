// ts-key-enum: 배포 JS 경로에 대한 타입 선언
declare module "ts-key-enum/dist/js/Key.enum.js" {
  const Key: any;           // 필요하면 더 좁게 타이핑해도 됨
  export default Key;
  export { Key };
}

/* (선택) 비슷한 이슈 예방용: ESM default만 있는 애들 */
declare module "linkify-it/index.js" {
  const LinkifyIt: any;
  export default LinkifyIt;
}
declare module "natural-compare-lite/index.js" {
  const cmp: (a: string, b: string) => number;
  export default cmp;
}