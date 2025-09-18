/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/

import {
  StagePanelLocation,
  StagePanelSection,
  UiItemsProvider,
  useActiveViewport,
  Widget,
  WidgetState,
} from "@itwin/appui-react";
import { Frustum } from "@itwin/core-common";
import { ScreenViewport, IModelApp } from "@itwin/core-frontend";
import { Point3d } from "@itwin/core-geometry";
import { useEffectSkipFirst } from "@itwin/core-react";
import { Id64String } from "@itwin/core-bentley";
import { Alert, LabeledSelect, SelectOption, ToggleSwitch } from "@itwin/itwinui-react";
import React, { useEffect, useRef } from "react";
import ReactDOM from "react-dom";
import { DividerComponent } from "./Divider";
import "./SwipingComparison.scss";
import SwipingComparisonApi, {
  ComparisonType,
  compareModels,             // 유지 (화면 클릭→시작용)
  compareModelsByLeft,      // 호환 alias (아래에서 compareByLeft로 교체됨)
  compareByLeft,            // 새 레이아웃 엔트리
  disableModelsCompare,
  setModelPair,
  setComparisonMode,
  setCategoryPair,
  setElementPair,
  isEnabled,
  onEnabledChange,
} from "./SwipingComparisonApi";

/** props */
interface SwipingComparisonWidgetProps { appContainerId: string }

/** prev hook */
function usePrevious<T>(value: T) {
  const ref = useRef<T>();
  useEffect(() => { ref.current = value; });
  return ref.current;
}

const INITIAL_LOCK_STATE = false;
const ENABLE_REALITY_DATA = false;

export const SwipingComparisonWidget = (props: SwipingComparisonWidgetProps) => {
  const viewport = useActiveViewport();

  const [viewRect, setViewRect] = React.useState<DOMRect>();
  const prevRect = usePrevious<DOMRect | undefined>(viewRect);
  const [dividerLeftState, setDividerLeftState] = React.useState<number>();
  const [isLockedState, setIsLockedState] = React.useState<boolean>(INITIAL_LOCK_STATE);

  const [screenPointState, setScreenPointState] = React.useState<Point3d>();
  const appContainer = useRef<Element | null>(null);
  const [frustum, setFrustum] = React.useState<Frustum>();
  const [comparisonState, setComparisonState] = React.useState<ComparisonType>(ComparisonType.RealityData);

  // Models
  const [leftModel, setLeftModel] = React.useState<Id64String | undefined>();
  const [rightModel, setRightModel] = React.useState<Id64String | undefined>();
  const [modelOptions, setModelOptions] = React.useState<SelectOption<Id64String>[]>([]);

  // Categories
  const [leftCategory, setLeftCategory] = React.useState<Id64String | undefined>();
  const [rightCategory, setRightCategory] = React.useState<Id64String | undefined>();
  const [categoryOptions, setCategoryOptions] = React.useState<SelectOption<Id64String>[]>([]);

  // Elements
  const [leftElems, setLeftElems] = React.useState<Id64String[] | undefined>();
  const [rightElems, setRightElems] = React.useState<Id64String[] | undefined>();

  const [widgetActive, setWidgetActive] = React.useState(false);
  const [swipeOn, setSwipeOn] = React.useState(false);

  // unmount cleanup (샌드박스 provider)
  useEffectSkipFirst(() => SwipingComparisonApi.teardown(), []);

  // appContainer (id 우선, 없으면 canvas 부모 fallback)
  useEffect(() => {
    if (!viewport) return;
    const byId = document.getElementById(props.appContainerId);
    if (byId) { appContainer.current = byId; return; }
    const canvasParent = viewport?.canvas?.parentElement ?? null;
    if (canvasParent) appContainer.current = canvasParent;
  }, [props, viewport]);

  // viewport 렌더 → frustum 추적(불필요 시 제거 가능)
  useEffect(() => {
    if (!viewport) return;
    const off = viewport.onRender.addListener((vp) => {
      const latest = SwipingComparisonApi.getFrustum(vp);
      if (!frustum || !frustum.isSame(latest)) setFrustum(latest);
    });
    return off;
  }, [viewport, frustum]);

  // viewport 리사이즈 → viewRect 갱신
  useEffect(() => {
    if (!viewport) return;
    const off = viewport.onResized.addListener((vp) => setViewRect(SwipingComparisonApi.getRect(vp as ScreenViewport)));
    return () => off();
  }, [viewport]);

  // 초기화(중앙에 핸들)
  useEffect(() => {
    if (!viewport) return;
    const r = SwipingComparisonApi.getRect(viewport);
    setViewRect(r);
    setFrustum(SwipingComparisonApi.getFrustum(viewport));
    const mid = r.left + (r.width / 2);
    setDividerLeftState(mid);

    viewport.viewFlags = viewport.viewFlags.copy({ clipVolume: true });
    if (ENABLE_REALITY_DATA && comparisonState === ComparisonType.RealityData) {
      SwipingComparisonApi.attachRealityData(viewport).catch(() => { /* no-op on Electron */ });
    }
  }, [viewport]);

  // 리사이즈 시 비율 유지
  useEffect(() => {
    if (!dividerLeftState || !prevRect || !viewRect) return;
    const ratio = (dividerLeftState - prevRect.left) / prevRect.width;
    setDividerLeftState(viewRect.left + ratio * viewRect.width);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewRect]);

  // RealityData 투명 토글(미사용이면 noop)
  useEffect(() => {
    if (viewport) SwipingComparisonApi.setRealityModelTransparent(viewport, comparisonState !== ComparisonType.RealityData);
  }, [viewport, comparisonState]);

  // 화면좌표 계산
  const calculateScreenPoint = (bounds: DOMRect, leftInWindowSpace: number): Point3d => {
    const y = bounds.top + (bounds.height / 2);
    const left = leftInWindowSpace - bounds.left;
    return new Point3d(left, y, 0);
  };
  useEffect(() => {
    if (viewport && dividerLeftState) {
      const bounds = SwipingComparisonApi.getRect(viewport);
      setScreenPointState(calculateScreenPoint(bounds, dividerLeftState));
    }
  }, [dividerLeftState, viewport]);

  // 뷰 변경 시 비교 수행 (Wireframe/RealityData/Models 트리거용)
  React.useEffect(() => {
    if (!viewport) return;
    const v = viewport;

    const listener = () => {
      if (!swipeOn) return;
      try {
        if (comparisonState === ComparisonType.Models) {
          compareModels(isLockedState ? undefined : screenPointState, v as ScreenViewport);
        } else if (comparisonState === ComparisonType.RealityData || comparisonState === ComparisonType.Wireframe) {
          SwipingComparisonApi.compare(isLockedState ? undefined : screenPointState, v, comparisonState);
        } else {
          // Categories/Elements는 divider 이동(compareByLeft)에서 처리
        }
      } catch (e) {
        console.warn("[Swiping] compare failed:", e);
      }
    };

    v.onViewChanged.addListener(listener);
    return () => { v.onViewChanged.removeListener(listener); };
  }, [viewport, swipeOn, comparisonState, isLockedState, screenPointState]);

  // 모드 전환/언마운트 시 정리
  useEffect(() => {
    if (viewport && comparisonState !== ComparisonType.Models)
      disableModelsCompare(viewport);
    return () => { if (viewport) disableModelsCompare(viewport); };
  }, [comparisonState, viewport]);

  // Divider onDrag → compareByLeft
  const _onDividerMoved = React.useCallback((leftWidth: number, rightWidth: number) => {
    if (!viewRect) return;
    const sliderW = viewRect.width - (leftWidth + rightWidth);
    const midLocal = leftWidth + (sliderW / 2);
    const midScreen = viewRect.left + midLocal;
    setDividerLeftState(midScreen);

    const vp = IModelApp.viewManager.selectedView as ScreenViewport | undefined;
    if (!vp || !isEnabled()) return;
    compareByLeft(midLocal, vp);
  }, [viewRect]);

  // 모델 목록
  useEffect(() => {
    if (!viewport) return;
    (async () => {
      const props = await viewport.iModel.models.queryProps({ from: "bis.SpatialModel" });
      const opts = props.filter(p => p.id).map(p => ({ value: p.id!, label: (p as any).name ?? p.id! }));
      setModelOptions(opts);
    })().catch(err => console.warn("[Swiping] load models failed:", err));
  }, [viewport]);

  // 카테고리 목록
  useEffect(() => {
    if (!viewport) return;
    (async () => {
      const cats = await viewport.iModel.elements.queryProps({ from: "bis.SpatialCategory" });
      const opts = cats
        .filter((c: any) => c.id)
        .map((c: any) => ({ value: c.id!, label: (c as any).code?.value ?? c.id! }));
      setCategoryOptions(opts);
    })().catch(err => console.warn("[Swiping] load categories failed:", err));
  }, [viewport]);

  // 비교 모드 옵션 목록
  const options: SelectOption<ComparisonType>[] = Object.entries(ComparisonType)
    .filter(([_, v]) => typeof v !== "string")
    .map(([k, v]) => ({ value: v as unknown as ComparisonType, label: k }));

  // mount 플래그
  React.useEffect(() => { setWidgetActive(true); return () => setWidgetActive(false); }, []);
  React.useEffect(() => {
    setSwipeOn(isEnabled());
    const off = onEnabledChange(setSwipeOn);
    return () => { if (typeof off === "function") off(); };
  }, []);

  return (
    <>
      {/* Divider 포털: 위젯 활성 + Swiping enable + host 존재 + 표시조건 충족일 때만 */}
      {appContainer.current && widgetActive && swipeOn && (() => {
        const showDivider = !!viewRect && dividerLeftState !== undefined && !isLockedState;
        return showDivider
          ? ReactDOM.createPortal(
              <DividerComponent
                sideL={dividerLeftState - viewRect.left}
                bounds={viewRect}
                onDragged={_onDividerMoved}
              />,
              appContainer.current
            )
          : null;
      })()}

      {/* 옵션 패널 */}
      <div className="sample-options">
        <ToggleSwitch
          label="Lock dividing plane"
          defaultChecked={INITIAL_LOCK_STATE}
          onChange={() => setIsLockedState(s => !s)}
        />
        <LabeledSelect
          label="Comparison Type"
          value={comparisonState}
          onChange={(v: ComparisonType) => { setComparisonState(v); setComparisonMode(v); }}
          disabled={!viewport}
          options={options}
        />

        {/* Models */}
        {comparisonState === ComparisonType.Models && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, alignItems: "end", marginTop: 8 }}>
            <LabeledSelect
              label="Left Model"
              value={leftModel}
              onChange={(v: Id64String) => {
                setLeftModel(v);
                setModelPair(v, rightModel);
                if (viewport && isEnabled() && rightModel && rightModel !== v)
                  requestAnimationFrame(() => compareModels(undefined, viewport));
              }}
              options={modelOptions}
            />
            <LabeledSelect
              label="Right Model"
              value={rightModel}
              onChange={(v: Id64String) => {
                setRightModel(v);
                setModelPair(leftModel, v);
                if (viewport && isEnabled() && leftModel && leftModel !== v)
                  requestAnimationFrame(() => compareModels(undefined, viewport));
              }}
              options={modelOptions}
            />
          </div>
        )}

        {/* Categories */}
        {comparisonState === ComparisonType.Categories && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, alignItems: "end", marginTop: 8 }}>
            <LabeledSelect
              label="Left Category"
              value={leftCategory}
              onChange={(v: Id64String) => {
                setLeftCategory(v);
                setCategoryPair(v, rightCategory);
                if (viewport && isEnabled() && rightCategory && rightCategory !== v)
                  requestAnimationFrame(() => compareModels(undefined, viewport));
              }}
              options={categoryOptions}
            />
            <LabeledSelect
              label="Right Category"
              value={rightCategory}
              onChange={(v: Id64String) => {
                setRightCategory(v);
                setCategoryPair(leftCategory, v);
                if (viewport && isEnabled() && leftCategory && leftCategory !== v)
                  requestAnimationFrame(() => compareModels(undefined, viewport));
              }}
              options={categoryOptions}
            />
          </div>
        )}

        {/* Elements */}
        {comparisonState === ComparisonType.Elements && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, alignItems: "center", marginTop: 8 }}>
            <div>
              <div style={{ fontSize: 12, marginBottom: 4 }}>Left Elements</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className="iui-button"
                  onClick={() => {
                    const ids = Array.from((viewport?.iModel.selectionSet.elements ?? new Set<Id64String>()).values());
                    setLeftElems(ids);
                    setElementPair(ids, rightElems);
                    if (viewport && isEnabled() && rightElems?.length)
                      requestAnimationFrame(() => compareModels(undefined, viewport));
                  }}
                >Use current selection</button>
                <span style={{ fontSize: 12, opacity: .7 }}>{leftElems?.length ?? 0} items</span>
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, marginBottom: 4 }}>Right Elements</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className="iui-button"
                  onClick={() => {
                    const ids = Array.from((viewport?.iModel.selectionSet.elements ?? new Set<Id64String>()).values());
                    setRightElems(ids);
                    setElementPair(leftElems, ids);
                    if (viewport && isEnabled() && leftElems?.length)
                      requestAnimationFrame(() => compareModels(undefined, viewport));
                  }}
                >Use current selection</button>
                <span style={{ fontSize: 12, opacity: .7 }}>{rightElems?.length ?? 0} items</span>
              </div>
            </div>
          </div>
        )}

        <Alert type="informational" className="instructions no-icon">
          Drag the divider to compare the two halves of the view. Try rotating the view with the "Lock dividing Plane" toggle on and off.
        </Alert>
      </div>
    </>
  );
};

export class SwipingComparisonWidgetProvider implements UiItemsProvider {
  public readonly id: string = "SwipingComparisonWidgetProvider";
  constructor(private readonly appContainerId: string) { }
  public provideWidgets(_stageId: string, _stageUsage: string, location: StagePanelLocation, _section?: StagePanelSection): ReadonlyArray<Widget> {
    const widgets: Widget[] = [];
    if (location === StagePanelLocation.Right) {
      widgets.push({
        id: "SwipingComparisonWidget",
        label: "Swiping Comparison Selector",
        defaultState: WidgetState.Closed,
        content: <SwipingComparisonWidget appContainerId={this.appContainerId} />,
      });
    }
    return widgets;
  }
}