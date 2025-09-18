/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/
import {
  ContextRealityModelProps,
  FeatureAppearanceProps,
  Frustum,
  RealityDataFormat,
  RealityDataProvider,
  RenderMode,
  ViewFlagOverrides,
} from "@itwin/core-common";
import {
  AccuDrawHintBuilder,
  FeatureSymbology,
  GraphicBranch,
  IModelApp,
  RenderClipVolume,
  SceneContext,
  ScreenViewport,
  SpatialViewState,
  TiledGraphicsProvider,
  TileTreeReference,
  Viewport,
  EmphasizeElements,
} from "@itwin/core-frontend";
import {
  ClipPlane,
  ClipPrimitive,
  ClipVector,
  ConvexClipPlaneSet,
  Point3d,
  Transform,
  Vector3d,
} from "@itwin/core-geometry";
import { RealityDataAccessClient } from "@itwin/reality-data-client";
import { Id64, Id64String } from "@itwin/core-bentley";

const DEBUG_SWIPE = true;

// ---------------------------------------------------------------------
// 비교 모드
// ---------------------------------------------------------------------
export enum ComparisonType {
  Wireframe = 0,
  RealityData = 1,
  Models = 2,
  Categories = 3,
  Elements = 4,
}

// ---------------------------------------------------------------------
// 모듈 스코프 상태
// ---------------------------------------------------------------------
let _enabled = false;
const _evtName = "swipe:enabled";

let _mode: ComparisonType = ComparisonType.RealityData;
export function setComparisonMode(m: ComparisonType) { _mode = m; }

// Models
let _leftModelId: Id64String | undefined;
let _rightModelId: Id64String | undefined;

// Categories
let _leftCatId: Id64String | undefined;
let _rightCatId: Id64String | undefined;

// Elements
let _leftElemIds: Id64String[] | undefined;
let _rightElemIds: Id64String[] | undefined;

// 오른쪽(보조) VP/컨테이너
let _rightWrap: HTMLDivElement | undefined;
let _rightVp: ScreenViewport | undefined;

// 좌→우 뷰 동기화 리스너 해제자
let _offLeftView: (() => void) | undefined;
let _offRightView: (() => void) | undefined;

// base(왼쪽) 복구를 위한 “우리가 바꾼 것만” 추적
const _baseHiddenByUs: Set<Id64String> = new globalThis.Set<Id64String>(); // false로 바꾼 id(모델/카테고리)
const _baseShownByUs:  Set<Id64String> = new globalThis.Set<Id64String>(); // true로 바꾼 id(모델/카테고리)
let _basePrevAlways: Id64String[] | undefined;             // 요소 alwaysDrawn 스냅샷
let _basePrevNever:  Id64String[] | undefined;            // 요소 neverDrawn 스냅샷

// EmphasizeElements 복원용 스냅샷(좌측 base용)
let _basePrevIsolated: Id64String[] | undefined;
let _basePrevEmphasized: Id64String[] | undefined;

function clearBaseChangeTrackers() {
  _baseHiddenByUs.clear();
  _baseShownByUs.clear();
  _basePrevAlways = undefined;
  _basePrevNever  = undefined;
}

// ---------------------------------------------------------------------
// enable/disable + 구독
// ---------------------------------------------------------------------
export function setEnabled(on: boolean) {
  _enabled = on;
  window.dispatchEvent(new CustomEvent(_evtName, { detail: on }));
  if (!on) disableModelsCompare();
}
export function isEnabled() { return _enabled; }
export function onEnabledChange(handler: (on: boolean) => void): () => void {
  const fn = (e: Event) => handler(!!(e as CustomEvent).detail);
  window.addEventListener(_evtName, fn);
  return () => window.removeEventListener(_evtName, fn);
}

// ---------------------------------------------------------------------
// 선택 세터(Models/Categories/Elements)
// ---------------------------------------------------------------------
export function setModelPair(left?: Id64String, right?: Id64String) {
  _leftModelId = left;
  _rightModelId = right;
  if (DEBUG_SWIPE) console.log("[Swiping] setModelPair", { left, right });
  if (left && right && left === right) {
    disableModelsCompare();
  }
}
export function setCategoryPair(left?: Id64String, right?: Id64String) {
  _leftCatId = left;
  _rightCatId = right;
  if (DEBUG_SWIPE) console.log("[Swiping] setCategoryPair", { left, right });
}
// 요소 페어 설정 (좌/우)
export function setElementPair(left?: Id64String[] | Id64String, right?: Id64String[] | Id64String, viewport?: ScreenViewport) {
  _leftElemIds  = Array.isArray(left)  ? left  : (left  ? [left]  : undefined);
  _rightElemIds = Array.isArray(right) ? right : (right ? [right] : undefined);

  if (DEBUG_SWIPE) {
    console.log("[Swiping] setElementPair", {
      leftCount: _leftElemIds?.length,
      rightCount: _rightElemIds?.length,
    });
  }

  // 스와이프 ON + vp가 있으면 즉시 반영
  if (_enabled && viewport) {
    try {
      applyElementIsolation(viewport);
    } catch (e) {
      console.warn("[Swiping] applyElementIsolation failed:", e);
    }
  }
}

// ---------------------------------------------------------------------
// Spatial 유틸
// ---------------------------------------------------------------------
function asSpatial(vp: Viewport): SpatialViewState | undefined {
  return vp.view.isSpatialView() ? vp.view as SpatialViewState : undefined;
}
function modelIdsInSelector(vp: Viewport): Id64String[] {
  const s = asSpatial(vp); if (!s) return [];
  return Array.from(s.modelSelector.models);
}
function categoryIdsInSelector(vp: Viewport): Id64String[] {
  const s = asSpatial(vp); if (!s) return [];
  return Array.from(s.categorySelector.categories);
}

// ---------------------------------------------------------------------
// 왼쪽(base) 최소 변경 isolate / 오른쪽(보조) 파괴적 isolate
// ---------------------------------------------------------------------
// Models
function isolateLeftMinimal_Model(base: Viewport, target: Id64String) {
  const s = asSpatial(base); if (!s) return;
  const all = modelIdsInSelector(base);
  if (!all.includes(target)) { try { s.modelSelector.addModels([target]); } catch {} }
  try { base.changeModelDisplay([target], true); _baseShownByUs.add(target); } catch {}
  const others = all.filter(id => id !== target);
  if (others.length) { try { base.changeModelDisplay(others, false); } catch {} for (const id of others) _baseHiddenByUs.add(id); }
}
function isolateRightDestructive_Model(right: Viewport, target: Id64String) {
  const s = asSpatial(right); if (!s) return;
  const all = modelIdsInSelector(right);
  if (!all.includes(target)) { try { s.modelSelector.addModels([target]); } catch {} }
  if (all.length) right.changeModelDisplay(all, false);
  right.changeModelDisplay([target], true);
}

// Categories
function isolateLeftMinimal_Category(base: Viewport, catId: Id64String) {
  const s = asSpatial(base); if (!s) return;
  const all = categoryIdsInSelector(base);
  if (!all.includes(catId)) { try { s.categorySelector.addCategories([catId]); } catch {} }
  try { base.changeCategoryDisplay([catId], true); _baseShownByUs.add(catId); } catch {}
  const others = all.filter(id => id !== catId);
  if (others.length) { try { base.changeCategoryDisplay(others, false); } catch {} for (const id of others) _baseHiddenByUs.add(id); }
}
function isolateRightDestructive_Category(right: Viewport, catId: Id64String) {
  const s = asSpatial(right); if (!s) return;
  const all = categoryIdsInSelector(right);
  if (!all.includes(catId)) { try { s.categorySelector.addCategories([catId]); } catch {} }
  if (all.length) right.changeCategoryDisplay(all, false);
  right.changeCategoryDisplay([catId], true);
}

// Elements: EmphasizeElements 사용
function isolateLeft_Elements(base: Viewport, elemIds: Id64String[]) {
  const emph = EmphasizeElements.getOrCreate(base);

  // 복원 스냅샷 (한 번만 저장)
  if (!_basePrevAlways) {
    const iso = emph.getIsolatedElements(base);
    const emp = emph.getEmphasizedElements(base);
    _basePrevAlways = iso ? Array.from(iso) : emp ? Array.from(emp) : undefined;
  }

  // 좌측 최소 변경: 요소 "격리"
  emph.isolateElements(elemIds, base, true);
  base.synchWithView();
}

function isolateRight_Elements(right: Viewport, elemIds: Id64String[]) {
  const emph = EmphasizeElements.getOrCreate(right);
  // 우측은 파괴적: 항상 격리 적용
  emph.isolateElements(elemIds, right, true);
  right.synchWithView();
}

function restoreLeft_Elements(base: Viewport) {
  const emph = EmphasizeElements.getOrCreate(base);

  // 기존 강조/격리 상태 제거
  emph.clearIsolatedElements(base);
  emph.clearEmphasizedElements(base);

  // 필요 시 이전 상태를 "강조"로만 복원 (격리 복원은 API 차이로 강조로 대체)
  if (_basePrevAlways && _basePrevAlways.length) {
    emph.emphasizeElements(_basePrevAlways, base, undefined, true);
  }

  _basePrevAlways = undefined;
  _basePrevNever  = undefined;
  base.synchWithView();
}

//좌/우 격리 적용 유틸 — “새로 추가”
function _clearEmphasize(vp: Viewport) {
  const emph = EmphasizeElements.getOrCreate(vp);
  emph.clearIsolatedElements(vp);
  emph.clearEmphasizedElements(vp);
}

function _isolateElements(vp: Viewport, elemIds?: Id64String[]) {
  const emph = EmphasizeElements.getOrCreate(vp);
  if (!elemIds || elemIds.length === 0) {
    _clearEmphasize(vp);
    return;
  }
  // 격리 적용: 다른 것들은 자동 숨김
  emph.isolateElements(elemIds, vp, true);
}

function _snapshotBaseEmphasize(vp: Viewport) {
  if (_basePrevIsolated || _basePrevEmphasized) return; // 한 번만 저장
  const emph = EmphasizeElements.getOrCreate(vp);
  const iso = emph.getIsolatedElements(vp);
  const emp = emph.getEmphasizedElements(vp);
  _basePrevIsolated  = iso ? Array.from(iso) : undefined;
  _basePrevEmphasized = emp ? Array.from(emp) : undefined;
}

function _restoreBaseEmphasize(vp: Viewport) {
  const emph = EmphasizeElements.getOrCreate(vp);
  _clearEmphasize(vp);
  // 격리 상태 복원이 필요하면 여기서 복구할 수 있음(보통 강조만 복원)
  if (_basePrevEmphasized && _basePrevEmphasized.length) {
    emph.emphasizeElements(_basePrevEmphasized, vp, undefined, true);
  }
  _basePrevIsolated = undefined;
  _basePrevEmphasized = undefined;
}

// 좌/우 요소 격리 “동시에” 반영
function applyElementIsolation(base: ScreenViewport) {
  // 스냅샷 저장(좌)
  _snapshotBaseEmphasize(base);

  // 좌측(base) 적용
  _isolateElements(base, _leftElemIds);
  // 즉시 반영
  base.invalidateScene();
  base.invalidateRenderPlan();

  // 우측(_rightVp) 적용
  if (_rightVp) {
    _isolateElements(_rightVp, _rightElemIds);
    _rightVp.invalidateScene();
    _rightVp.invalidateRenderPlan();
  }
}

// === style helpers ===
function applyRightWrapStyle(el: HTMLDivElement) {
  // 오른쪽 오버레이용 컨테이너 스타일 (기본 VP 위에 겹침, 입력은 막음)
  Object.assign(el.style, {
    position: "absolute",
    top: "0",
    height: "100%",
    overflow: "hidden",
    zIndex: "0",            // HUD/오버레이보다 뒤
    pointerEvents: "none",  // 오른쪽 뷰는 입력 비활성 (선택/카메라는 base만)
  } as CSSStyleDeclaration);
}

// ---------------------------------------------------------------------
// 호스트/레이아웃
// ---------------------------------------------------------------------
function getHostContainer(vp: ScreenViewport): HTMLElement | null {
  return vp.canvas?.parentElement ?? null;
}

async function ensureRightViewport(base: ScreenViewport, leftPx?: number) {
  const host = getHostContainer(base);
  if (!host) return;

  // host rect 기준으로 좌/우 폭 계산
  const rect = host.getBoundingClientRect();
  const leftWidth  = Math.max(1, Math.min(rect.width - 1, leftPx ?? Math.round(rect.width / 2)));
  const rightWidth = Math.max(1, rect.width - leftWidth);

  // 1) 오른쪽 컨테이너 준비
  if (!_rightWrap) {
    _rightWrap = document.createElement("div");

    // 기존 유틸이 있으면 사용
    if (typeof applyRightWrapStyle === "function") {
      applyRightWrapStyle(_rightWrap);
    } else {
      // fallback 스타일
      Object.assign(_rightWrap.style, {
        position: "absolute",
        top: "0",
        height: "100%",
        overflow: "hidden",
        zIndex: "0",
        pointerEvents: "none", // 입력은 base 쪽만 받도록
      } as CSSStyleDeclaration);
    }

    // host의 "맨 앞"에 넣어도 절대 positioned 이라 base canvas 위에 그려짐.
    host.insertBefore(_rightWrap, host.firstChild ?? null);
  }
  _rightWrap.style.left  = `${leftWidth}px`;
  _rightWrap.style.width = `${rightWidth}px`;

  // 2) 오른쪽 Viewport 준비
  if (!_rightVp) {
    const cloned = base.view.clone();
    _rightVp = ScreenViewport.create(_rightWrap, cloned);
    IModelApp.viewManager.addViewport(_rightVp);

    // 캔버스 크기를 래퍼 100%에 맞춤 + 입력 차단
    const rc = _rightVp.canvas as HTMLCanvasElement;
    rc.style.width  = "100%";
    rc.style.height = "100%";
    rc.style.pointerEvents = "none"; // 중요: 우측은 입력 비활성(카메라/선택은 base만)
  } else {
    // 이미 있다면 위치/크기만 갱신
    _rightWrap.style.left  = `${leftWidth}px`;
    _rightWrap.style.width = `${rightWidth}px`;
  }

  // 3) 카메라/프러스텀 동기화 (좌 → 우 단방향)
  if (!_offLeftView) {
    const leftListener = () => {
      if (!_rightVp) return;
      try {
        _rightVp.changeView(base.view.clone());
        // 요소/모델 격리 상태를 우측에도 유지
        applyElementIsolation(base);
      } catch { /* noop */ }
    };
    base.onViewChanged.addListener(leftListener);
    _offLeftView = () => base.onViewChanged.removeListener(leftListener);
  }

  // 4) (선택) 우 → 좌 동기화가 필요하면 아래 블록을 활성화
  //    기본 동작은 base를 '주 뷰'로 고정하기 위해 등록하지 않음.
  if (_rightVp && !_offRightView) {
    const rightListener = () => {
      // 보통은 좌→우만 동기화하지만, 양방향이 필요하면 아래 주석 해제
      // try {
      //   base.changeView(_rightVp!.view.clone());
      //   applyElementIsolation(base);
      // } catch { /* noop */ }
    };
    _rightVp.onViewChanged.addListener(rightListener);
    _offRightView = () => _rightVp?.onViewChanged.removeListener(rightListener);
  }

  // 5) 현재 분할 상태에서 요소/모델 격리 즉시 반영
  applyElementIsolation(base);

  // 6) 항상 base가 활성(입력) 뷰가 되게 강제
  try { IModelApp.viewManager.setSelectedView(base); } catch { /* noop */ }
}

function updateRightLayout(screenX: number | undefined, base: ScreenViewport) {
  if (!_rightWrap) return;
  const host = getHostContainer(base);
  if (!host) return;
  const rect = host.getBoundingClientRect();

  const x = screenX !== undefined ? Math.max(rect.left + 1, Math.min(rect.right - 1, screenX))
                                  : rect.left + rect.width / 2;

  const leftWidth  = Math.round(x - rect.left);
  const rightWidth = Math.max(1, rect.width - leftWidth);

  _rightWrap.style.left  = `${leftWidth}px`;
  _rightWrap.style.width = `${rightWidth}px`;
}

// ---------------------------------------------------------------------
// 분할 실행 API (Divider가 넘겨주는 local-left px 사용)
// ---------------------------------------------------------------------
export function compareByLeft(leftPx: number | undefined, viewport: ScreenViewport): void {
  if (!_enabled) return;

  try {
    void ensureRightViewport(viewport, leftPx);
    updateRightLayout(leftPx, viewport);
    try { IModelApp.viewManager.setSelectedView(viewport); } catch {}
  } catch (err) {
    console.warn("[Swiping] compareByLeft layout error:", err);
    disableModelsCompare(viewport);
    setEnabled(false);
    return;
  }

  try {
    switch (_mode) {
      case ComparisonType.Models:
        if (_leftModelId) isolateLeftMinimal_Model(viewport, _leftModelId);
        if (_rightVp && _rightModelId) isolateRightDestructive_Model(_rightVp, _rightModelId);
        break;
      case ComparisonType.Categories:
        if (_leftCatId) isolateLeftMinimal_Category(viewport, _leftCatId);
        if (_rightVp && _rightCatId) isolateRightDestructive_Category(_rightVp, _rightCatId);
        break;
      case ComparisonType.Elements:
        if (_leftElemIds?.length) isolateLeft_Elements(viewport, _leftElemIds);
        if (_rightVp && _rightElemIds?.length) isolateRight_Elements(_rightVp, _rightElemIds);
        break;
      default:
        break;
    }
  } catch (err) {
    console.warn("[Swiping] compareByLeft apply error:", err);
  }
}

// ✅ 기존 호환 함수 유지
export function compareModelsByLeft(leftPx: number | undefined, viewport: ScreenViewport): void {
  compareByLeft(leftPx, viewport);
}

// Divider가 아닌 화면 클릭으로 시작하는 옛 compare 진입(좌표 → leftPx 변환만 수행)
export function compareModels(screenPoint: Point3d | undefined, viewport: ScreenViewport): void {
  if (!_enabled) return;
  const host = getHostContainer(viewport);
  if (!host) return;

  let leftPx: number | undefined;
  if (screenPoint) {
    const r = host.getBoundingClientRect();
    leftPx = Math.max(1, Math.min(r.width - 1, Math.round(screenPoint.x - r.left)));
  }
  compareByLeft(leftPx, viewport);
}

// ---------------------------------------------------------------------
// 비교 종료/정리
// ---------------------------------------------------------------------
export function disableModelsCompare(viewport?: ScreenViewport): void {
  // 좌측(base) Emphasize 복원
  if (viewport) {
    try { _restoreBaseEmphasize(viewport); } catch {}
    viewport.invalidateScene();
    viewport.invalidateRenderPlan();
  }

  // 우측 Emphasize 해제 + 우측 VP 제거
  if (_rightVp) {
    try { _clearEmphasize(_rightVp); } catch {}
    try { IModelApp.viewManager.dropViewport(_rightVp); } catch {}
    _rightVp = undefined;
  }
  if (_rightWrap?.parentElement) _rightWrap.parentElement.removeChild(_rightWrap);
  _rightWrap = undefined;

  // 래퍼 제거 후, 좌측을 다시 선택 뷰로
  if (viewport) {
    try { IModelApp.viewManager.setSelectedView(viewport); } catch {}
  }

  // 내부 상태 초기화
  _leftElemIds = undefined;
  _rightElemIds = undefined;

  // 기타 리스너 해제
  try { _offLeftView?.(); } catch {}  _offLeftView = undefined;
  try { _offRightView?.(); } catch {} _offRightView = undefined;
}

// ---------------------------------------------------------------------
// (샌드박스 원본) Wireframe/RealityData 비교용 Provider 클래스 - 유지
// ---------------------------------------------------------------------
export default class SwipingComparisonApi {
  private static _provider: SampleTiledGraphicsProvider | undefined;
  private static _viewport?: Viewport;

  public static teardown(): void {
    if (undefined !== SwipingComparisonApi._viewport && undefined !== SwipingComparisonApi._provider) {
      SwipingComparisonApi.disposeProvider(SwipingComparisonApi._viewport, SwipingComparisonApi._provider);
      SwipingComparisonApi._provider = undefined;
    }
  }

  public static listerForViewportUpdate(viewport: Viewport, onUpdate: (viewport: Viewport) => void): () => void {
    return viewport.onRender.addListener(onUpdate);
  }

  public static getFrustum(vp: Viewport): Frustum { return vp.getFrustum().clone(); }
  public static getRect(vp: ScreenViewport): DOMRect { return DOMRect.fromRect(vp.getClientRect()); }
  public static getWorldPoint(vp: Viewport, screenPoint: Point3d): Point3d { return vp.viewToWorld(screenPoint); }
  public static getPerpendicularNormal(vp: Viewport, screenPoint: Point3d): Vector3d {
    const point = SwipingComparisonApi.getWorldPoint(vp, screenPoint);
    const boresite = AccuDrawHintBuilder.getBoresite(point, vp);
    const viewY = vp.rotation.rowY();
    return viewY.crossProduct(boresite.direction);
  }

  public static compare(screenPoint: Point3d | undefined, viewport: Viewport, comparisonType: ComparisonType) {
    if (viewport.viewportId !== SwipingComparisonApi._viewport?.viewportId)
      SwipingComparisonApi.teardown();
    SwipingComparisonApi._viewport = viewport;
    const provider = SwipingComparisonApi._provider;
    if (!viewport.view.isSpatialView())
      return;

    let oldClipVector: ClipVector | undefined;
    if (undefined !== provider && provider.comparisonType !== comparisonType) {
      if (screenPoint === undefined)
        oldClipVector = this._provider?.clipVolume?.clipVector;
      SwipingComparisonApi.disposeProvider(viewport, SwipingComparisonApi._provider!);
      SwipingComparisonApi._provider = undefined;
    }

    if (undefined === SwipingComparisonApi._provider && (screenPoint || oldClipVector)) {
      if (screenPoint)
        SwipingComparisonApi._provider = SwipingComparisonApi.createProvider(screenPoint, viewport, comparisonType);
      else if (oldClipVector)
        SwipingComparisonApi._provider = SwipingComparisonApi.createProvider(oldClipVector, viewport, comparisonType);
      if (SwipingComparisonApi._provider)
        viewport.addTiledGraphicsProvider(SwipingComparisonApi._provider);
    }
    if (screenPoint !== undefined && SwipingComparisonApi._provider)
      SwipingComparisonApi.updateProvider(screenPoint, viewport, SwipingComparisonApi._provider);
  }

  private static createClip(vec: Vector3d, pt: Point3d): ClipVector {
    const plane = ClipPlane.createNormalAndPoint(vec, pt)!;
    const planes = ConvexClipPlaneSet.createPlanes([plane]);
    return ClipVector.createCapture([ClipPrimitive.createCapture(planes)]);
  }

  private static updateProvider(screenPoint: Point3d, viewport: Viewport, provider: SampleTiledGraphicsProvider) {
    const normal = SwipingComparisonApi.getPerpendicularNormal(viewport, screenPoint);
    const worldPoint = SwipingComparisonApi.getWorldPoint(viewport, screenPoint);

    const clip = SwipingComparisonApi.createClip(normal.clone().negate(), worldPoint);
    provider.setClipVector(clip);

    viewport.view.setViewClip(SwipingComparisonApi.createClip(normal.clone(), worldPoint));
    viewport.synchWithView();
  }

  private static createProvider(arg: Point3d | ClipVector, viewport: Viewport, type: ComparisonType): SampleTiledGraphicsProvider {
    let rtnProvider: SampleTiledGraphicsProvider;
    const createClipVectorFromPoint = (point: Point3d) => {
      const normal = SwipingComparisonApi.getPerpendicularNormal(viewport, point);
      return SwipingComparisonApi.createClip(normal.clone().negate(), SwipingComparisonApi.getWorldPoint(viewport, point));
    };
    const negatedClip: ClipVector = arg instanceof ClipVector ? arg : createClipVectorFromPoint(arg);
    switch (type) {
      case ComparisonType.Wireframe:
      default:
        rtnProvider = new ComparisonWireframeProvider(negatedClip);
        break;
      case ComparisonType.RealityData:
        rtnProvider = new ComparisonRealityModelProvider(negatedClip);
        break;
    }
    return rtnProvider;
  }

  private static disposeProvider(viewport: Viewport, provider: SampleTiledGraphicsProvider) {
    viewport.dropTiledGraphicsProvider(provider);
  }

  public static async attachRealityData(_viewport: Viewport) { /* Electron 미사용 시 skip */ }
  public static setRealityModelTransparent(_vp: Viewport, _transparent: boolean): void { /* 필요 시 구현 */ }
}

abstract class SampleTiledGraphicsProvider implements TiledGraphicsProvider {
  public readonly abstract comparisonType: ComparisonType;
  public viewFlagOverrides: ViewFlagOverrides = { clipVolume: false };
  public clipVolume: RenderClipVolume | undefined;
  constructor(clipVector: ClipVector) { this.setClipVector(clipVector); }

  public forEachTileTreeRef(viewport: ScreenViewport, func: (ref: TileTreeReference) => void): void {
    viewport.view.forEachTileTreeRef(func);
    this.viewFlagOverrides.clipVolume = false;
  }

  public addToScene(output: SceneContext): void {
    const vp = output.viewport;
    const clip = vp.view.getViewClip();

    vp.view.setViewClip(this.clipVolume?.clipVector);
    this.prepareNewBranch(vp);

    const context: SceneContext = new SceneContext(vp);
    vp.view.createScene(context);

    const gfx = context.graphics;
    if (0 < gfx.length) {
      const ovrs = new FeatureSymbology.Overrides(vp);
      const branch = new GraphicBranch();
      branch.symbologyOverrides = ovrs;
      for (const gf of gfx) branch.entries.push(gf);
      branch.setViewFlagOverrides(this.viewFlagOverrides);
      output.outputGraphic(IModelApp.renderSystem.createGraphicBranch(branch, Transform.createIdentity(), { clipVolume: this.clipVolume }));
    }

    vp.view.setViewClip(clip);
    this.resetOldView(vp);
  }

  protected abstract prepareNewBranch(vp: Viewport): void;
  protected abstract resetOldView(vp: Viewport): void;

  public setClipVector(clipVector: ClipVector): void {
    this.clipVolume = IModelApp.renderSystem.createClipVolume(clipVector);
  }
}

class ComparisonWireframeProvider extends SampleTiledGraphicsProvider {
  public comparisonType = ComparisonType.Wireframe;
  constructor(clip: ClipVector) { super(clip); this.viewFlagOverrides.renderMode = RenderMode.Wireframe; }
  protected prepareNewBranch(_vp: Viewport): void { }
  protected resetOldView(_vp: Viewport): void { }
}

class ComparisonRealityModelProvider extends SampleTiledGraphicsProvider {
  public comparisonType = ComparisonType.RealityData;
  protected prepareNewBranch(vp: Viewport): void { SwipingComparisonApi.setRealityModelTransparent(vp, true); }
  protected resetOldView(vp: Viewport): void { SwipingComparisonApi.setRealityModelTransparent(vp, false); }
}