/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/
import { 
  ContextRealityModelProps, 
  FeatureAppearance, 
  FeatureAppearanceProps, 
  Frustum, 
  RealityDataFormat, 
  RealityDataProvider, 
  RenderMode, 
  ViewFlagOverrides 
} from "@itwin/core-common";
import { 
  AccuDrawHintBuilder, 
  FeatureSymbology, 
  GraphicBranch, 
  IModelApp, 
  RenderClipVolume, 
  SceneContext, 
  ScreenViewport, 
  TiledGraphicsProvider, 
  TileTreeReference, 
  Viewport,
  connectViewportFrusta  
} from "@itwin/core-frontend";
import { 
  ClipPlane, 
  ClipPrimitive, 
  ClipVector, 
  ConvexClipPlaneSet, 
  Point3d, 
  Transform, 
  Vector3d 
} from "@itwin/core-geometry";
import { RealityDataAccessClient, RealityDataResponse } from "@itwin/reality-data-client";
import { Id64String } from "@itwin/core-bentley";

const DEBUG_SWIPE = true;  // 필요 없으면 false

export enum ComparisonType {
  Wireframe = 0,
  RealityData = 1,
  Models = 2, //  추가
}

// modul scope state
let _enabled = false;
const _evtName = "swipe:enabled";

let _leftModelId: Id64String | undefined;
let _rightModelId: Id64String | undefined;

let _overlayDiv: HTMLDivElement | undefined;
let _overlayVp: ScreenViewport | undefined;
let _disconnectSync: (() => void) | undefined;

let _baseHiddenModels: Id64String[] = [];  // base vp에서 임시로 끈 모델들 복구용
let _offResize: (() => void) | undefined;
let _offViewChanged: (() => void) | undefined;
let _offDpr: (() => void) | undefined;  //DPR 감지 해제용
let _resizeObserver: ResizeObserver | undefined; // 컨테이너 크기 감시자
let _creatingOverlay = false;      // 중복 생성 가드
let _rafId: number | undefined;    // clipPath 업데이트 턴당 1회로 제한

// ▶ 분할 화면용 상태 (추가)
let _leftWrap: HTMLDivElement | undefined;      // base 캔버스를 담을 왼쪽 컨테이너
let _rightWrap: HTMLDivElement | undefined;     // 오른쪽 뷰포트 컨테이너
let _rightVp: ScreenViewport | undefined;       // 오른쪽 뷰포트
let _offLeftView: (() => void) | undefined;                 // 좌측 뷰 변경 리스너 해제
let _offRightView: (() => void) | undefined;                // 우측 뷰 변경 리스너 해제
let _savedHostCssPosition = "";                 // host CSS 복구용

// 래퍼 스타일 공용함수
function applyWrapStyle(el: HTMLDivElement) {
  Object.assign(el.style, {
    position: "absolute",
    top: "0",
    height: "100%",
    overflow: "hidden",
    // 🔑 오버레이(HUD)보다 아래에 깔림
    zIndex: "0",
    // pointerEvents는 기본 auto 유지 (자식 canvas가 이벤트 받음)
  } as CSSStyleDeclaration);
}

function applyRightWrapStyle(el: HTMLDivElement) {
  Object.assign(el.style, {
    position: "absolute",
    top: "0",
    height: "100%",
    overflow: "hidden",
    zIndex: "0",             // HUD가 위로 오도록 낮은 z-index
    pointerEvents: "none",   // 입력은 기본 VP로만 보냄
  } as CSSStyleDeclaration);
}

export default class SwipingComparisonApi {
  private static _provider: SampleTiledGraphicsProvider | undefined;
  private static _viewport?: Viewport;

  /** Called by the showcase before swapping to another sample. */
  public static teardown(): void {
    if (undefined !== SwipingComparisonApi._viewport && undefined !== SwipingComparisonApi._provider) {
      SwipingComparisonApi.disposeProvider(SwipingComparisonApi._viewport, SwipingComparisonApi._provider);
      SwipingComparisonApi._provider = undefined;
    }
  }

  /** Adds a listener that will be triggered when the viewport is updated. Returns a functions to remove that listener. */
  public static listerForViewportUpdate(viewport: Viewport, onUpdate: (viewport: Viewport) => void): () => void {
    // There is event in the viewport called onViewChanged.  As stated in the js docs, the function is invoked, VERY frequently.
    //  Using that event when doing heavy changes in that event, performance can start to suffer.
    return viewport.onRender.addListener(onUpdate);
  }

  /** Get the frustum of the camera using the viewport API. */
  public static getFrustum(vp: Viewport): Frustum {
    return vp.getFrustum().clone();
  }

  /** Get the rectangle defining the area of the HTML canvas using the viewport API. */
  public static getRect(vp: ScreenViewport): DOMRect {
    // Calling DOMRect.fromRect to clone the rect so the state in the App will update properly.
    return DOMRect.fromRect(vp.getClientRect());
  }

  /** Convert a point in the view space to the world space using the viewport API. */
  public static getWorldPoint(vp: Viewport, screenPoint: Point3d): Point3d {
    return vp.viewToWorld(screenPoint);
  }

  /** Return a vector perpendicular to the view considering the camera's perspective. */
  public static getPerpendicularNormal(vp: Viewport, screenPoint: Point3d): Vector3d {
    const point = SwipingComparisonApi.getWorldPoint(vp, screenPoint);

    const boresite = AccuDrawHintBuilder.getBoresite(point, vp);
    const viewY = vp.rotation.rowY();
    const normal = viewY.crossProduct(boresite.direction);
    return normal;
  }

  /** Will create an effect allowing for different views on either side of an arbitrary point in the view space.  This will allows us to compare the effect the views have on the iModel. */
  public static compare(screenPoint: Point3d | undefined, viewport: Viewport, comparisonType: ComparisonType) {
    if (viewport.viewportId !== SwipingComparisonApi._viewport?.viewportId)
      SwipingComparisonApi.teardown();
    SwipingComparisonApi._viewport = viewport;
    const provider = SwipingComparisonApi._provider;
    if (!viewport.view.isSpatialView())
      return;

    let oldClipVector: ClipVector | undefined;
    if (undefined !== provider && provider.comparisonType !== comparisonType) {
      // Save the old ClipVector if the screen point is not provided.
      // We will use this if a new provider is needed.
      if (screenPoint === undefined)
        oldClipVector = this._provider?.clipVolume?.clipVector;
      SwipingComparisonApi.disposeProvider(viewport, SwipingComparisonApi._provider!);
      SwipingComparisonApi._provider = undefined;
    }

    if (undefined === SwipingComparisonApi._provider && (screenPoint || oldClipVector)) {
      if (screenPoint)
        // Use the screen point if provided.
        SwipingComparisonApi._provider = SwipingComparisonApi.createProvider(screenPoint, viewport, comparisonType);
      else if (oldClipVector)
        // Use the old Clip Vector if it's available.
        SwipingComparisonApi._provider = SwipingComparisonApi.createProvider(oldClipVector, viewport, comparisonType);
      if (SwipingComparisonApi._provider)
        // If the provider was created, add that to the viewport.
        viewport.addTiledGraphicsProvider(SwipingComparisonApi._provider);
    }
    if (screenPoint !== undefined && SwipingComparisonApi._provider)
      SwipingComparisonApi.updateProvider(screenPoint, viewport, SwipingComparisonApi._provider);
  }

  /** Creates a [ClipVector] based on the arguments. */
  private static createClip(vec: Vector3d, pt: Point3d): ClipVector {
    const plane = ClipPlane.createNormalAndPoint(vec, pt)!;
    const planes = ConvexClipPlaneSet.createPlanes([plane]);
    return ClipVector.createCapture([ClipPrimitive.createCapture(planes)]);
  }

  /** Updates the location of the clipping plane in both the provider and viewport. */
  private static updateProvider(screenPoint: Point3d, viewport: Viewport, provider: SampleTiledGraphicsProvider) {
    // Update Clipping plane in provider and in the view.
    const normal = SwipingComparisonApi.getPerpendicularNormal(viewport, screenPoint);
    const worldPoint = SwipingComparisonApi.getWorldPoint(viewport, screenPoint);

    // Update in Provider
    const clip = SwipingComparisonApi.createClip(normal.clone().negate(), worldPoint);
    provider.setClipVector(clip);

    // Update in Viewport
    viewport.view.setViewClip(SwipingComparisonApi.createClip(normal.clone(), worldPoint));
    viewport.synchWithView();
  }

  /** Creates a [TiledGraphicsProvider] and adds it to the viewport.  This also sets the clipping plane used for the comparison. */
  private static createProvider(arg: Point3d | ClipVector, viewport: Viewport, type: ComparisonType): SampleTiledGraphicsProvider {
    let rtnProvider: SampleTiledGraphicsProvider;
    const createClipVectorFromPoint = (point: Point3d) => {
      const normal = SwipingComparisonApi.getPerpendicularNormal(viewport, point);

      // Note the normal is negated, this is flip the clipping plane created from it.
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

  /** Removes the provider from the viewport, and disposed of any resources it has. */
  private static disposeProvider(viewport: Viewport, provider: SampleTiledGraphicsProvider) {
    viewport.dropTiledGraphicsProvider(provider);
  }

  /** Get first available reality models and attach it to displayStyle. */
  public static async attachRealityData(viewport: Viewport) { /*
    const imodel = viewport.iModel;
    const style = viewport.displayStyle.clone();
    const RealityDataClient = new RealityDataAccessClient();
    const available: RealityDataResponse = await RealityDataClient.getRealityDatas(await IModelApp.authorizationClient!.getAccessToken(), imodel.iTwinId, undefined);

    const availableModels: ContextRealityModelProps[] = [];

    for (const rdEntry of available.realityDatas) {
      const name = undefined !== rdEntry.displayName ? rdEntry.displayName : rdEntry.id;
      const rdSourceKey = {
        provider: RealityDataProvider.ContextShare,
        format: rdEntry.type === "OPC" ? RealityDataFormat.OPC : RealityDataFormat.ThreeDTile,
        id: rdEntry.id,
      };
      const tilesetUrl = await IModelApp.realityDataAccess?.getRealityDataUrl(imodel.iTwinId, rdSourceKey.id);
      if (tilesetUrl) {
        const entry: ContextRealityModelProps = {
          rdSourceKey,
          tilesetUrl,
          name,
          description: rdEntry?.description,
          realityDataId: rdSourceKey.id,
        };

        availableModels.push(entry);
        break;
      }
    }

    for (const crmProp of availableModels) {
      style.attachRealityModel(crmProp);
      viewport.displayStyle = style;
    } */
  }

  /** Set the transparency of the reality models using the Feature Override API. */
  public static setRealityModelTransparent(vp: Viewport, transparent: boolean): void { /*
    const override: FeatureAppearanceProps = { transparency: (transparent ?? false) ? 1 : 0 };
    vp.displayStyle.settings.contextRealityModels.models.forEach((model) => {
      model.appearanceOverrides = model.appearanceOverrides ? model.appearanceOverrides.clone(override) : FeatureAppearance.fromJSON(override);
    }); */
  }
}

abstract class SampleTiledGraphicsProvider implements TiledGraphicsProvider {
  public readonly abstract comparisonType: ComparisonType;
  public viewFlagOverrides: ViewFlagOverrides = { clipVolume: false };
  public clipVolume: RenderClipVolume | undefined;
  constructor(clipVector: ClipVector) {
    // Create the object that will be used later by the "addToScene" method.
    this.setClipVector(clipVector);
  }

  /** Apply the supplied function to each [[TileTreeReference]] to be drawn in the specified [[Viewport]]. */
  public forEachTileTreeRef(viewport: ScreenViewport, func: (ref: TileTreeReference) => void): void {
    viewport.view.forEachTileTreeRef(func);

    // Do not apply the view's clip to this provider's graphics - it applies its own (opposite) clip to its graphics.
    this.viewFlagOverrides.clipVolume = false;
  }

  /** Overrides the logic for adding this provider's graphics into the scene. */
  public addToScene(output: SceneContext): void {

    // Save view to be replaced after comparison is drawn
    const vp = output.viewport;
    const clip = vp.view.getViewClip();

    // Replace the clipping plane with a flipped one.
    vp.view.setViewClip(this.clipVolume?.clipVector);

    this.prepareNewBranch(vp);

    const context: SceneContext = new SceneContext(vp);
    vp.view.createScene(context);

    // This graphics branch contains the graphics that were excluded by the flipped clipping plane
    const gfx = context.graphics;
    if (0 < gfx.length) {
      const ovrs = new FeatureSymbology.Overrides(vp);

      const branch = new GraphicBranch();
      branch.symbologyOverrides = ovrs;
      for (const gf of gfx)
        branch.entries.push(gf);

      // Overwrites the view flags for this view branch.
      branch.setViewFlagOverrides(this.viewFlagOverrides);
      // Draw the graphics to the screen.
      output.outputGraphic(IModelApp.renderSystem.createGraphicBranch(branch, Transform.createIdentity(), { clipVolume: this.clipVolume }));
    }

    // Return the old clip to the view.
    vp.view.setViewClip(clip);

    this.resetOldView(vp);
  }

  protected abstract prepareNewBranch(vp: Viewport): void;
  protected abstract resetOldView(vp: Viewport): void;

  /** The clip vector passed in should be flipped with respect to the normally applied clip vector.
   * It could be calculated in the "addToScene(...)" but we want to optimize that method.
   */
  public setClipVector(clipVector: ClipVector): void {
    this.clipVolume = IModelApp.renderSystem.createClipVolume(clipVector);
  }
}

class ComparisonWireframeProvider extends SampleTiledGraphicsProvider {
  public comparisonType = ComparisonType.Wireframe;

  constructor(clip: ClipVector) {
    super(clip);
    // Create the objects that will be used later by the "addToScene" method.
    this.viewFlagOverrides.renderMode = RenderMode.Wireframe;
  }

  protected prepareNewBranch(_vp: Viewport): void { }
  protected resetOldView(_vp: Viewport): void { }
}

class ComparisonRealityModelProvider extends SampleTiledGraphicsProvider {
  public comparisonType = ComparisonType.RealityData;

  protected prepareNewBranch(vp: Viewport): void {
    // Hides the reality model while rendering the other graphics branch.
    SwipingComparisonApi.setRealityModelTransparent(vp, true);
  }
  protected resetOldView(vp: Viewport): void {
    // Makes the reality model visible again in the viewport.
    SwipingComparisonApi.setRealityModelTransparent(vp, false);
  }
}

// --- enable/disable 통지 ---
export function setEnabled(on: boolean) {
  _enabled = on;
  // 위젯이 즉시 반응하도록 브라우저 이벤트로 알림
  window.dispatchEvent(new CustomEvent(_evtName, { detail: on }));
  // 끌 때는 깨끗이 정리
  if (!on) disableModelsCompare(/* viewport optional */);
}

export function isEnabled() { return _enabled; }

export function onEnabledChange(handler: (on: boolean) => void): () => void {
  const fn = (e: Event) => handler(!!(e as CustomEvent).detail);
  window.addEventListener(_evtName, fn);
  return () => window.removeEventListener(_evtName, fn);
}

export function setModelPair(left?: Id64String, right?: Id64String) {
  _leftModelId = left;
  _rightModelId = right;
  if (left && right && left === right) {
  console.log("[pair]", _leftModelId, _rightModelId);

  // 동일 선택이면 비교를 끄고 종료
  disableModelsCompare(/* viewport optional */);
  return;
  }
}

function forceViewportCanvasSize(vp: ScreenViewport, hostRect: DOMRect) {
  const dpr = window.devicePixelRatio || 1;
  const cssW = Math.max(1, Math.round(hostRect.width));
  const cssH = Math.max(1, Math.round(hostRect.height));
  const devW = Math.max(1, Math.round(cssW * dpr));
  const devH = Math.max(1, Math.round(cssH * dpr));

  const c = vp.canvas as HTMLCanvasElement;
  // CSS 크기
  c.style.width = `${cssW}px`;
  c.style.height = `${cssH}px`;
  // 실제 버퍼 크기
  if (c.width !== devW) c.width = devW;
  if (c.height !== devH) c.height = devH;

  // ✅ 여기서 vp.onResized() 같은 호출은 하지 않음.
  // (리사이즈는 ResizeObserver/base.onResized에서 overlay를 파기하고 재생성)
}


// --- 오버레이 VP 생성 (크기 0 가드 + 리사이즈/뷰 변경 동기화 포함) ---
export async function createOverlayViewport(base: ScreenViewport): Promise<ScreenViewport | undefined> {
  if (_overlayVp && !_overlayVp.isDisposed) return _overlayVp;

  const host = getHostContainer(base);
  if (!host) return undefined;

  const rect = host.getBoundingClientRect();
  if (rect.width <= 1 || rect.height <= 1) return undefined;

  // host 배치 보정
  const cs = window.getComputedStyle(host);
  if (cs.position === "static") (host as HTMLElement).style.position = "relative";

  // overlay root
  const overlay = document.createElement("div");
  overlay.style.position = "absolute";
  overlay.style.inset = "0";
  overlay.style.pointerEvents = "none"; // 부모는 none
  overlay.style.overflow = "hidden";    // clip-path와 함께 안전
  overlay.style.zIndex = "20";
  host.appendChild(overlay);
  _overlayDiv = overlay;

  // overlay VP
  const clonedView = base.view.clone();
  const vp2 = ScreenViewport.create(overlay, clonedView);
  IModelApp.viewManager.addViewport(vp2);

  // ⛔ 가장 중요: 캔버스 자체도 이벤트 차단 (HTML은 pointer-events 상속 안 됨)
  const ovCanvas = vp2.canvas as HTMLCanvasElement;
  ovCanvas.style.pointerEvents = "none";

  // 크기 강제 동기(버퍼/스타일)
  forceViewportCanvasSize(vp2, rect);

  // 우측 모델만
  if (_rightModelId) showOnlyModel(vp2, _rightModelId);

  // 중앙 분할 초기값
  updateOverlayClip(undefined, base);

  // 뷰/카메라 동기화 (changeView → 우측 모델 재적용)
  _offViewChanged?.();
  const viewListener = () => {
    try {
      vp2.changeView(base.view.clone());
      if (_rightModelId) showOnlyModel(vp2, _rightModelId);
    } catch { /* noop */ }
  };
  base.onViewChanged.addListener(viewListener);
  _offViewChanged = () => base.onViewChanged.removeListener(viewListener);

  // 리사이즈/레이아웃/DPR 변화 시 overlay 파기 → 다음 compare에서 재생성
  const destroyOverlay = () => {
    try {
      if (_overlayVp) { IModelApp.viewManager.dropViewport(_overlayVp); _overlayVp = undefined; }
      if (_overlayDiv?.parentElement) _overlayDiv.parentElement.removeChild(_overlayDiv);
      _overlayDiv = undefined;
    } catch { /* noop */ }
  };

  _offResize?.();
  const resizeListener = (_vp: Viewport) => destroyOverlay();
  base.onResized.addListener(resizeListener);
  _offResize = () => base.onResized.removeListener(resizeListener);

  _resizeObserver?.disconnect();
  _resizeObserver = new ResizeObserver(() => destroyOverlay());
  _resizeObserver.observe(host);

  _offDpr?.();
  const mq = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
  const dprListener = () => destroyOverlay();
  mq.addEventListener("change", dprListener);
  _offDpr = () => mq.removeEventListener("change", dprListener);

  _overlayVp = vp2;
  return vp2;
}

// --- Models 비교 준비 (동일 모델/비활성 가드) ---
export async function ensureOverlayForModels(vp: ScreenViewport): Promise<void> {
  if (!_enabled) return;
  if (!bothModelsReady()) { disableModelsCompare(vp); return; }
  if (_creatingOverlay) return;

  _creatingOverlay = true;
  try {
    // base에 Left만
    if (_baseHiddenModels.length === 0) {
      const models = allDisplayedModels(vp);
      _baseHiddenModels = models.filter((id) => id !== _leftModelId);
    }
    if (_leftModelId) showOnlyModel(vp, _leftModelId);

    // overlay에 Right만
    const ov = await createOverlayViewport(vp);
    if (!ov) return;
    if (_rightModelId) showOnlyModel(ov, _rightModelId);
  } finally {
    _creatingOverlay = false;
  }
}

// --- 클립 업데이트 (오른쪽만 보이도록 왼쪽을 잘라냄) ---
export function updateOverlayClip(screenX: number | undefined, vp: ScreenViewport): void {
  if (_rafId) cancelAnimationFrame(_rafId);
  _rafId = requestAnimationFrame(() => {
    _rafId = undefined;
    if (!_overlayDiv) return;
    const r = vp.canvas.getBoundingClientRect();
    const x = screenX !== undefined ? Math.max(r.left, Math.min(r.right, screenX))
                                    : (r.left + r.right) / 2;
    const leftPx = x - r.left;

    // 오른쪽만 보이도록 왼쪽 영역을 잘라냄
    const clip = `polygon(${leftPx}px 0, 100% 0, 100% 100%, ${leftPx}px 100%)`;
    _overlayDiv.style.clipPath = clip;

    if (DEBUG_SWIPE) {
      // drag 중 스팸이 심하면 DEBUG_SWIPE를 false로 꺼도 됩니다.
      // 최근 1~2회만 보고 싶으면 throttle 넣어도 됩니다.
      console.log("[Swiping] clip leftPx=", Math.round(leftPx), "rect=", r.width, r.height);
    }
  });
}

// --- 드래그/마우스 움직임에 따른 비교 엔트리 ---
export function compareModels(screenPoint: Point3d | undefined, viewport: ScreenViewport): void {
  if (!_enabled) return;
  const host = getHostContainer(viewport);
  if (!host) return;

  let leftPx: number | undefined;
  if (screenPoint) {
    const r = host.getBoundingClientRect();
    leftPx = Math.max(1, Math.min(r.width - 1, Math.round(screenPoint.x - r.left)));
  }
  compareModelsByLeft(leftPx, viewport);
}

// --- 내부 유틸 ---
function getHostContainer(vp: ScreenViewport): HTMLElement | null {
  return vp.canvas?.parentElement ?? null;
}

function allDisplayedModels(vp: Viewport): Id64String[] {
  if (!vp.view.isSpatialView())
    return [];
  const ids: Id64String[] = [];
  for (const id of vp.view.modelSelector.models)
    ids.push(id);
  return ids;
}

function showOnlyModel(vp: Viewport, modelId: Id64String): void {
  const models = allDisplayedModels(vp);
  const toHide = models.filter((id) => id !== modelId);
  if (toHide.length)
    vp.changeModelDisplay(toHide, false);     // 표시 중인 모델들 끄기
  vp.changeModelDisplay([modelId], true);     // 대상 모델만 켜기
}

// --- 비교 해제/정리 (View Clip 전환/위젯 닫힘 포함) ---
export function disableModelsCompare(viewport?: ScreenViewport): void {
  // 리스너 해제
  try { _offLeftView?.(); } catch {} _offLeftView = undefined;

  // base 모델 가시성 복구
  if (viewport && _baseHiddenModels.length) {
    try { viewport.changeModelDisplay(_baseHiddenModels, true); } catch {}
  }
  _baseHiddenModels = [];

  // 오른쪽 VP 제거
  if (_rightVp) { try { IModelApp.viewManager.dropViewport(_rightVp); } catch {} _rightVp = undefined; }
  if (_rightWrap?.parentElement) _rightWrap.parentElement.removeChild(_rightWrap);
  _rightWrap = undefined;

  // (선택) 혹시라도 우측이 selectedView였으면 좌측으로 되돌리기
  if (viewport) { try { IModelApp.viewManager.setSelectedView(viewport); } catch {} }
}


// 편의
function bothModelsReady(): boolean {
  return !!(_leftModelId && _rightModelId && _leftModelId !== _rightModelId);
}

async function ensureSplitForModels(base: ScreenViewport, leftPx?: number) {
  const host = getHostContainer(base);
  if (!host) return;

  const cs = window.getComputedStyle(host as HTMLElement);
  if (cs.position === "static") {
    _savedHostCssPosition = (host as HTMLElement).style.position;
    (host as HTMLElement).style.position = "relative";
  }

  const rect = host.getBoundingClientRect();
  const leftWidth  = Math.max(1, Math.min(rect.width - 1, leftPx ?? rect.width / 2));
  const rightWidth = Math.max(1, rect.width - leftWidth);

  // 1) 왼쪽 컨테이너 생성 + base 캔버스 붙이기
  if (!_leftWrap) {
    _leftWrap = document.createElement("div");
    applyWrapStyle(_leftWrap);
    _leftWrap.style.left  = "0";
    _leftWrap.style.width = `${leftWidth}px`;

    // ✅ host의 맨 앞에 삽입 → HUD/오버레이가 항상 위로 온다
    host.insertBefore(_leftWrap, host.firstChild ?? null);
    console.log("[host children]", Array.from(host.children).map(n => (n as HTMLElement).className || n.tagName));

    const c = base.canvas as HTMLCanvasElement;
    _leftWrap.appendChild(c);
    c.style.width  = "100%";
    c.style.height = "100%";
  } else {
    _leftWrap.style.width = `${leftWidth}px`;
  }


  // 2) 오른쪽 컨테이너 + 뷰포트 생성
  if (!_rightWrap) {
    _rightWrap = document.createElement("div");
    applyWrapStyle(_rightWrap);
    _rightWrap.style.left  = `${leftWidth}px`;
    _rightWrap.style.width = `${rightWidth}px`;

    // ✅ 오른쪽 래퍼도 맨 앞에 삽입 (좌/우 둘 다 래퍼가 항상 뒤층)
    host.insertBefore(_rightWrap, host.firstChild ?? null);

    const cloned = base.view.clone();
    _rightVp = ScreenViewport.create(_rightWrap, cloned);
    IModelApp.viewManager.addViewport(_rightVp);

    const rc = _rightVp.canvas as HTMLCanvasElement;
    rc.style.width  = "100%";
    rc.style.height = "100%";
  } else {
    _rightWrap.style.left  = `${leftWidth}px`;
    _rightWrap.style.width = `${rightWidth}px`;
  }

  // 좌/우 가시성
  if (_leftModelId)  showOnlyModel(base, _leftModelId);
  if (_rightVp && _rightModelId) showOnlyModel(_rightVp, _rightModelId);

  // 카메라/프러스텀 동기화 (양방향) – changeView 후 모델 재적용
  if (!_offLeftView) {
    const leftListener = () => {
      if (!_rightVp) return;
      try {
        _rightVp.changeView(base.view.clone());
        if (_rightModelId) showOnlyModel(_rightVp, _rightModelId);
      } catch {}
    };
    base.onViewChanged.addListener(leftListener);
    _offLeftView = () => base.onViewChanged.removeListener(leftListener);
  }

  if (_rightVp && !_offRightView) {
    const rightListener = () => {
      try {
        base.changeView(_rightVp!.view.clone());
        if (_leftModelId) showOnlyModel(base, _leftModelId);
      } catch {}
    };
    _rightVp.onViewChanged.addListener(rightListener);
    _offRightView = () => _rightVp?.onViewChanged.removeListener(rightListener);
  }
}

function updateSplitLayout(screenX: number | undefined, base: ScreenViewport) {
  const host = getHostContainer(base);
  if (!host || !_leftWrap || !_rightWrap) return;
  const rect = host.getBoundingClientRect();

  const x = screenX !== undefined ? Math.max(rect.left + 1, Math.min(rect.right - 1, screenX))
                                  : rect.left + rect.width / 2;
  const leftWidth = Math.round(x - rect.left);
  const rightWidth = Math.max(1, rect.width - leftWidth);

  _leftWrap.style.width  = `${leftWidth}px`;
  _rightWrap.style.left  = `${leftWidth}px`;
  _rightWrap.style.width = `${rightWidth}px`;

  // ✅ onResized() 직접 호출 없이, 다음 프레임에서 자동 감지
}

// 오른쪽 VP 생성/갱신 (Swiping ON 때만 호출)
async function ensureRightViewport(base: ScreenViewport, leftPx?: number) {
  const host = getHostContainer(base);
  if (!host) return;

  const rect = host.getBoundingClientRect();
  const leftWidth  = Math.max(1, Math.min(rect.width - 1, leftPx ?? Math.round(rect.width / 2)));
  const rightWidth = Math.max(1, rect.width - leftWidth);

  // 컨테이너
  if (!_rightWrap) {
    _rightWrap = document.createElement("div");
    Object.assign(_rightWrap.style, {
      position: "absolute",
      top: "0",
      height: "100%",
      overflow: "hidden",
      zIndex: "0",            // HUD 위에 올라가지 않도록 낮춤
      pointerEvents: "none",  // 입력은 좌측(base)로만
    } as CSSStyleDeclaration);
    // host 맨 앞에 삽입 (항상 뒤층)
    host.insertBefore(_rightWrap, host.firstChild ?? null);
  }
  _rightWrap.style.left  = `${leftWidth}px`;
  _rightWrap.style.width = `${rightWidth}px`;

  // 보조 VP
  if (!_rightVp) {
    const cloned = base.view.clone();
    _rightVp = ScreenViewport.create(_rightWrap, cloned);
    IModelApp.viewManager.addViewport(_rightVp);
    const rc = _rightVp.canvas as HTMLCanvasElement;
    rc.style.width  = "100%";
    rc.style.height = "100%";
    rc.style.pointerEvents = "none";  // 혹시 몰라 한 번 더
  }

  // ▶ 새 VP가 선택되는 것을 즉시 되돌림 (중요)
  try { IModelApp.viewManager.setSelectedView(base); } catch {}

  // 좌/우 가시성
  if (_baseHiddenModels.length === 0) {
    const all = allDisplayedModels(base);
    _baseHiddenModels = _leftModelId ? all.filter(id => id !== _leftModelId) : [];
    if (_baseHiddenModels.length) base.changeModelDisplay(_baseHiddenModels, false);
  }
  if (_leftModelId) base.changeModelDisplay([_leftModelId], true);
  if (_rightModelId && _rightVp) showOnlyModel(_rightVp, _rightModelId);

  // 좌 → 우 카메라 동기화
  if (!_offLeftView) {
    const leftListener = () => {
      if (!_rightVp) return;
      try {
        _rightVp.changeView(base.view.clone());
        // changeView가 모델표시를 덮어쓰므로 재적용
        if (_rightModelId) showOnlyModel(_rightVp, _rightModelId);
      } catch {}
    };
    base.onViewChanged.addListener(leftListener);
    _offLeftView = () => base.onViewChanged.removeListener(leftListener);
  }
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

  // 캔버스는 style 100%라 다음 프레임에 자동 반영됨 (onResized 직접 호출하지 않음)
}

// Divider가 넘기는 '왼쪽 픽셀값(local)'로 갱신
export function compareModelsByLeft(leftPx: number | undefined, viewport: ScreenViewport): void {
  if (!_enabled) return;
  if (!_leftModelId || !_rightModelId || _leftModelId === _rightModelId) {
    disableModelsCompare(viewport);
    return;
  }
  try {
    void ensureRightViewport(viewport, leftPx);
    if (leftPx !== undefined && _rightWrap) {
      // 레이아웃 즉시 반영
      const host = getHostContainer(viewport)!;
      const rect = host.getBoundingClientRect();
      const clamped = Math.max(1, Math.min(rect.width - 1, Math.round(leftPx)));
      _rightWrap.style.left  = `${clamped}px`;
      _rightWrap.style.width = `${Math.max(1, rect.width - clamped)}px`;
    }
  } catch (err) {
    console.warn("[Swiping] compareModelsByLeft error:", err);
    disableModelsCompare(viewport);
    setEnabled(false);
  }
}

