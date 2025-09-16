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

export enum ComparisonType {
  Wireframe = 0,
  RealityData = 1,
  Models = 2, //  추가
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
  public static async attachRealityData(viewport: Viewport) {
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
    }
  }

  /** Set the transparency of the reality models using the Feature Override API. */
  public static setRealityModelTransparent(vp: Viewport, transparent: boolean): void {
    const override: FeatureAppearanceProps = { transparency: (transparent ?? false) ? 1 : 0 };
    vp.displayStyle.settings.contextRealityModels.models.forEach((model) => {
      model.appearanceOverrides = model.appearanceOverrides ? model.appearanceOverrides.clone(override) : FeatureAppearance.fromJSON(override);
    });
  }
}

// 내부 상태 저장용
let _leftModelId: Id64String | undefined;
let _rightModelId: Id64String | undefined;

let _overlayDiv: HTMLDivElement | undefined;
let _overlayVp: ScreenViewport | undefined;
let _disconnectSync: (() => void) | undefined;
let _baseHiddenModels: Id64String[] = [];  // base vp에서 임시로 끈 모델들 복구용

export function setModelPair(left?: Id64String, right?: Id64String) {
  _leftModelId = left;
  _rightModelId = right;
}

async function createOverlayViewport(base: ScreenViewport): Promise<ScreenViewport | undefined> {
  const host = getHostContainer(base);
  if (!host) return undefined;
  if (_overlayVp && !_overlayVp.isDisposed) return _overlayVp;

  // host가 static이면 overlay 절대배치가 안 먹을 수 있어 보정
  const cs = window.getComputedStyle(host);
  if (cs.position === "static")
    (host as HTMLElement).style.position = "relative";

  const overlay = document.createElement("div");
  overlay.style.position = "absolute";
  overlay.style.inset = "0";
  overlay.style.pointerEvents = "none";   // 입력은 base vp로 통과
  overlay.style.zIndex = "20";
  host.appendChild(overlay);
  _overlayDiv = overlay;

  const clonedView = base.view.clone();                         // 뷰 복제
  const vp2 = ScreenViewport.create(overlay, clonedView);       // 오버레이 VP 생성
  IModelApp.viewManager.addViewport(vp2);

  // 카메라/줌 등 프러스텀 동기화
  _disconnectSync = connectViewportFrusta([base, vp2]);  // 필요 시 connectViewportViews로 변경 가능

  _overlayVp = vp2;
  return vp2;
}

// 경로 A: 오버레이용 보조 뷰포트 생성/해제/동기화 유틸
export async function ensureOverlayForModels(vp: ScreenViewport): Promise<void> {
  if (!_leftModelId || !_rightModelId)
    return;

  // base vp는 Left 모델만
  if (_baseHiddenModels.length === 0) {
    const models = allDisplayedModels(vp);
    _baseHiddenModels = models.filter((id) => id !== _leftModelId);
  }
  showOnlyModel(vp, _leftModelId);

  // overlay vp는 Right 모델만
  const ov = await createOverlayViewport(vp);
  if (!ov) return;
  showOnlyModel(ov, _rightModelId);
}

export function updateOverlayClip(screenX: number | undefined, vp: ScreenViewport): void {
  if (!_overlayDiv) return;
  const rect = vp.canvas.getBoundingClientRect();
  const x = screenX !== undefined
    ? Math.max(rect.left, Math.min(rect.right, screenX))
    : (rect.left + rect.right) / 2;   // 포인트 없으면 중앙
  const leftPx = x - rect.left;
  // 오버레이(오른쪽)만 보이도록 왼쪽을 잘라냄
  _overlayDiv.style.clipPath = `inset(0px 0px 0px ${leftPx}px)`;
}

/** Widget에서 드래그 포인트 갱신 시 호출 */
export function compareModels(screenPoint: Point3d | undefined, viewport: ScreenViewport): void {
  void ensureOverlayForModels(viewport);
  updateOverlayClip(screenPoint?.x, viewport);
}

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

/** 모드 해제/위젯 닫기 시 정리 */
export function disableModelsCompare(viewport?: ScreenViewport): void {
  // base vp 모델 복구
  if (viewport && _baseHiddenModels.length) {
    viewport.changeModelDisplay(_baseHiddenModels, true);
    _baseHiddenModels = [];
  }
  // overlay vp 제거
  if (_overlayVp) {
    if (_disconnectSync) { _disconnectSync(); _disconnectSync = undefined; }
    IModelApp.viewManager.dropViewport(_overlayVp);  // dispose 포함
    _overlayVp = undefined;
  }
  if (_overlayDiv?.parentElement)
    _overlayDiv.parentElement.removeChild(_overlayDiv);
  _overlayDiv = undefined;
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