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
  compareModels, 
  disableModelsCompare, 
  setModelPair,
  isEnabled,
  onEnabledChange,
  compareModelsByLeft
} from "./SwipingComparisonApi";


interface SwipingComparisonWidgetProps { appContainerId: string }

/** Custom hook to hold the previous value of a state. */
function usePrevious<T>(value: T) {
  const ref = useRef<T>();
  // On Every render, save the value.
  useEffect(() => {
    ref.current = value;
  });
  return ref.current;
}

const INITIAL_LOCK_STATE = false;
const ENABLE_REALITY_DATA = false; // Electron 데스크톱에서 Reality Data 미사용이면 false

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

  const [leftModel, setLeftModel] = React.useState<Id64String | undefined>();
  const [rightModel, setRightModel] = React.useState<Id64String | undefined>();
  const [modelOptions, setModelOptions] = React.useState<SelectOption<Id64String>[]>([]);

  const [widgetActive, setWidgetActive] = React.useState(false);
  const [swipeOn, setSwipeOn] = React.useState(false);


  // Clean up on dismount
  useEffectSkipFirst(() => SwipingComparisonApi.teardown(), []);

  useEffect(() => {
    if (!viewport) return;

    // 1) props로 받은 id 우선
    const byId = document.getElementById(props.appContainerId);
    if (byId) {
      appContainer.current = byId;
      return;
    }

    // 2) 못 찾으면, 현재 viewport의 canvas 기준 부모 엘리먼트 사용(데스크톱 뷰어에서도 안전)
    const canvasParent = viewport?.canvas?.parentElement ?? null;
    if (canvasParent)
      appContainer.current = canvasParent;

  }, [props, viewport]);

  // eslint-disable-next-line no-console
  useEffect(() => viewport?.iModel.selectionSet.onChanged.addListener((ev) => console.debug(...ev.set.elements.entries())), [viewport]);

  useEffect(() => {
    const el = document.getElementById(props.appContainerId);
    if (el) appContainer.current = el;  // ✅ 찾았을 때만 교체 (fallback 보존)
  }, [props]);

  useEffect(() => {
    if (!viewport) return;
    // Start listener for view being navigated.
    const unsubscribeRender = viewport.onRender.addListener((vp) => {
      const latestFrustum = SwipingComparisonApi.getFrustum(vp);
      if (frustum === undefined || !frustum.isSame(latestFrustum))
        setFrustum(latestFrustum);
    });
    // return callback to unsubscribe to event
    return unsubscribeRender;
  }, [viewport, frustum]);

  useEffect(() => {
    if (!viewport) return;
    // Start listener for Viewport getting resized.
    const unsubscribeOnResize = viewport.onResized.addListener((vp) => {
      setViewRect(SwipingComparisonApi.getRect(vp as ScreenViewport));
    });
    // return callback to unsubscribe to event
    return () => unsubscribeOnResize();
  }, [viewport]);

  /** Initialize the view and all the viewport dependant states. */
  useEffect(() => {
    if (!viewport) return;
    // Initialize the divider position and bounds.
    const clientRect = SwipingComparisonApi.getRect(viewport);
    setViewRect(clientRect);
    // Initial position of the divider is centered on the viewport
    const dividerPos = clientRect.left + (clientRect.width / 2);
    setFrustum(SwipingComparisonApi.getFrustum(viewport));
    setDividerLeftState(dividerPos);

    // 기본 플래그만 켜고, Reality Data 부착은 필요할 때만 (그리고 활성화된 경우에만)
    viewport.viewFlags = viewport.viewFlags.copy({ clipVolume: true });
    if (ENABLE_REALITY_DATA && comparisonState === ComparisonType.RealityData) {
      SwipingComparisonApi.attachRealityData(viewport).catch((e) => {
        // Electron IPC 핸들러가 없으면 그냥 스킵
        console.warn("[Swiping] RealityData attach skipped:", e);
      });
    }
  }, [viewport]);

  /** Reacting to the viewport resizing. */
  useEffect(() => {
    if (dividerLeftState === undefined
      || prevRect === undefined
      || viewRect === undefined
    )
      return;
    const oldBounds = prevRect, newBounds = viewRect;
    const dividerRatio = (dividerLeftState - oldBounds.left) / oldBounds.width;
    const newLeft = (dividerRatio * newBounds.width) + newBounds.left;
    setDividerLeftState(newLeft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewRect]);

  useEffect(() => {
    if (viewport) {
      SwipingComparisonApi.setRealityModelTransparent(viewport, comparisonState !== ComparisonType.RealityData);
    }
  }, [viewport, comparisonState]);

  const calculateScreenPoint = (bounds: DOMRect, leftInWindowSpace: number): Point3d => {
    const y = bounds.top + (bounds.height / 2);
    // The point needs to be returned relative to the canvas.
    const left = leftInWindowSpace - bounds.left;
    return new Point3d(left, y, 0);
  };

  useEffect(() => {
    if (viewport && dividerLeftState) {
      const bounds = SwipingComparisonApi.getRect(viewport);
      const newScreenPoint = calculateScreenPoint(bounds, dividerLeftState);
      setScreenPointState(newScreenPoint);
    }
  }, [dividerLeftState, viewport]);

  // 뷰가 바뀔 때 compare 실행. viewport가 없으면 등록/해제 안 함.
  React.useEffect(() => {
    if (!viewport) return;

    // TS에 확실히 알려주기 위해 좁힌 값을 클로저에 캡처
    const v = viewport;

    const listener = () => {
      if (!swipeOn) return;
      try {
        if (comparisonState === ComparisonType.Models)
          compareModels(isLockedState ? undefined : screenPointState, v);
        else
          SwipingComparisonApi.compare(isLockedState ? undefined : screenPointState, v, comparisonState);
      } catch (e) {
        console.warn("[Swiping] compare failed:", e);
      }
    };

    // 등록
    v.onViewChanged.addListener(listener);

    // 중요: cleanup은 "함수"를 반환해야 하고, 그 함수는 다시 아무것도 반환하지 않아야 함 (boolean 반환 금지)
    return () => {
      // removeListener는 boolean을 반환하지만, 우리는 그 값을 반환하지 않는다.
      v.onViewChanged.removeListener(listener);
    };
  }, [viewport, swipeOn, comparisonState, isLockedState, screenPointState]);

  // 모드 전환/언마운트 시 정리
  useEffect(() => {
     if (viewport && comparisonState !== ComparisonType.Models)
      disableModelsCompare(viewport);

    return () => {
      if (viewport)
        disableModelsCompare(viewport); // 언마운트도 정리
    };
  }, [comparisonState, viewport]);

  // 기존 setState 로직 유지 + API는 'local-left(px) = 핸들 중앙'으로 전달
  const _onDividerMoved = React.useCallback((leftWidth: number, rightWidth: number) => {
    if (!viewRect) return;

    // 핸들(슬라이더) 실제 폭 = 전체폭 - (left+right)
    const sliderWidth = viewRect.width - (leftWidth + rightWidth);

    // 핸들 "중앙"의 local-left(px) (뷰 컨테이너 기준)
    const midLocalLeft = leftWidth + (sliderWidth / 2);

    // 화면 절대 좌표(렌더링 상태 업데이트용)
    const midScreenLeft = viewRect.left + midLocalLeft;
    setDividerLeftState(midScreenLeft);

    // Swiping Compare 동작 (오른쪽 VP 레이아웃 조정)
    const vp = IModelApp.viewManager.selectedView as ScreenViewport | undefined;
    if (!vp || !isEnabled()) return;
    compareModelsByLeft(midLocalLeft, vp);
  }, [viewRect]);

  // 모델 목록 로드 (SpatialModel만 조회)
  useEffect(() => {
    if (!viewport) return;
    (async () => {
      const props = await viewport.iModel.models.queryProps({ from: "bis.SpatialModel" });
      const opts = props
        .filter(p => p.id)
        .map(p => ({ value: p.id!, label: (p as any).name ?? p.id! }));
      setModelOptions(opts);
    })();
  }, [viewport]);

  // ComparisonType 옵션 확장 (Models 추가)
  const options: SelectOption<ComparisonType>[] = Object.entries(ComparisonType)
    .filter(([_, value]: any) => typeof value !== "string")
    .map(([key, value]) => ({ value: (value as ComparisonType), label: key }));

  // 위젯이 마운트되었을 때만 true, 언마운트 시 false
  React.useEffect(() => {
    setWidgetActive(true);
    return () => setWidgetActive(false);
  }, []);

  React.useEffect(() => {
    setSwipeOn(isEnabled());
    const off = onEnabledChange(setSwipeOn); // () => void 를 돌려줌
    return () => {
      // React cleanup은 void만 허용 → 호출만 하고 반환값(없음)을 그대로 둠
      if (typeof off === "function") off();
    };
  }, []);
  
  // 이미 있는 appContainer ref 사용 가정
  // const appContainer = React.useRef<HTMLElement | null>(null);

  // "찾았을 때만" 교체 — 못 찾으면 기존(fallback) 그대로 둠
  React.useEffect(() => {
    // 1) props의 id로 우선 시도
    if (props.appContainerId) {
      const el = document.getElementById(props.appContainerId);
      if (el) {
        appContainer.current = el;
        return;
      }
    }

    // 2) 못 찾았으면 현재 viewport의 canvas 부모를 fallback으로
    const vp = IModelApp.viewManager.selectedView as ScreenViewport | undefined;
    if (!appContainer.current && vp?.canvas?.parentElement) {
      appContainer.current = vp.canvas.parentElement;
    }
  }, [props.appContainerId]);

  //모델 리스트 로딩에 재시도 가드
  React.useEffect(() => {
    if (!viewport) return;
    let cancelled = false;
    let tries = 0;

    const load = async () => {
      try {
        const props = await viewport.iModel.models.queryProps({ from: "bis.SpatialModel" });
        if (cancelled) return;
        const opts = props.filter(p => p.id).map(p => ({ value: p.id!, label: (p as any).name ?? p.id! }));
        setModelOptions(opts);
      } catch (err) {
        if (cancelled) return;
        const msg = String(err ?? "");
        if ((/db is not open/i).test(msg) && tries < 10) {
          tries++;
          setTimeout(load, 250);
        } else {
          console.warn("[Swiping] load models failed:", err);
        }
      }
    };

    load();
    return () => { cancelled = true; };
  }, [viewport]);

  return (
    <>
      {/* Divider 포털: 위젯 활성 + Swiping enable + host 존재 + 표시조건 충족일 때만 */}
      {appContainer.current && widgetActive && swipeOn && (() => {
        const showDivider = !!viewRect && dividerLeftState !== undefined && !isLockedState;
        return showDivider
          ? ReactDOM.createPortal(
              <>
                <DividerComponent
                  sideL={dividerLeftState - viewRect.left}
                  bounds={viewRect}
                  onDragged={_onDividerMoved}
                />
              </>,
              appContainer.current
            )
          : null;
      })()}

      {/* 옵션 패널 */}
      <div className="sample-options">
        <ToggleSwitch
          label="Lock dividing plane"
          defaultChecked={INITIAL_LOCK_STATE}
          onChange={() => setIsLockedState((state) => !state)}
        />
        <LabeledSelect
          label="Comparison Type"
          value={comparisonState}
          onChange={(value: ComparisonType) => setComparisonState(value)}
          disabled={undefined === viewport}
          options={options}
        />
        {/* Models 모드일 때만 좌/우 모델 선택 표시 */}
        {comparisonState === ComparisonType.Models && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "12px",
              alignItems: "end",
              marginTop: "8px",
            }}
          >
            <LabeledSelect
              label="Left Model"
              value={leftModel}
              onChange={(v: Id64String) => {
                setLeftModel(v);
                if (!rightModel || rightModel !== v) setModelPair(v, rightModel);
                // ✅ 두 모델이 모두 정해졌고 스와이프 켜져 있으면 즉시 비교 시작
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
                if (!leftModel || leftModel !== v) setModelPair(leftModel, v);
                if (viewport && isEnabled() && leftModel && leftModel !== v)
                  requestAnimationFrame(() => compareModels(undefined, viewport));
              }}
              options={modelOptions}
            />
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

  constructor(private readonly appContainerId: string) {
  }

  public provideWidgets(_stageId: string, _stageUsage: string, location: StagePanelLocation, _section?: StagePanelSection): ReadonlyArray<Widget> {
    const widgets: Widget[] = [];
    if (location === StagePanelLocation.Right) {
      widgets.push(
        {
          id: "SwipingComparisonWidget",
          label: "Swiping Comparison Selector",
          defaultState: WidgetState.Closed,
          // eslint-disable-next-line react/display-name
          content: <SwipingComparisonWidget appContainerId={this.appContainerId} />,
        }
      );
    }
    return widgets;
  }
}