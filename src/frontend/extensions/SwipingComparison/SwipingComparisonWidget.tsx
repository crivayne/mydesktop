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
  WidgetState
} from "@itwin/appui-react";
import { Frustum } from "@itwin/core-common";
import { ScreenViewport } from "@itwin/core-frontend";
import { Point3d } from "@itwin/core-geometry";
import { useEffectSkipFirst } from "@itwin/core-react";
import { Id64String } from "@itwin/core-bentley";
import { Alert, LabeledSelect, SelectOption, ToggleSwitch } from "@itwin/itwinui-react";
import React, { useEffect, useRef } from "react";
import ReactDOM from "react-dom";
import { DividerComponent } from "./Divider";
import "./SwipingComparison.scss";
import SwipingComparisonApi, { ComparisonType, compareModels, disableModelsCompare, setModelPair } from "./SwipingComparisonApi";


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

const SwipingComparisonWidget = (props: SwipingComparisonWidgetProps) => {
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
    if (!appContainer.current || appContainer.current.id !== props.appContainerId)
      appContainer.current = document.getElementById(props.appContainerId);
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

    viewport.viewFlags = viewport.viewFlags.copy({ clipVolume: true });

    // Attach reality data so it's visible in the viewport
    SwipingComparisonApi.attachRealityData(viewport)
      .catch((error) => {
        // eslint-disable-next-line no-console
        console.error(error);
      });
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

  // 스와이프 마우스/포인터 이동 시
  useEffect(() => {
    if (viewport && screenPointState && frustum) {
      if (comparisonState === ComparisonType.Models)
        compareModels(isLockedState ? undefined : screenPointState, viewport);
      else
        SwipingComparisonApi.compare(isLockedState ? undefined : screenPointState, viewport, comparisonState);
    }
  }, [comparisonState, frustum, screenPointState, viewport, isLockedState]);

  // 모드 전환/언마운트 시 정리
  useEffect(() => {
    if (comparisonState !== ComparisonType.Models && viewport)
      disableModelsCompare(viewport);

    return () => {
      if (viewport)
        disableModelsCompare(viewport);
    };
  }, [comparisonState, viewport]);

  const _onDividerMoved = (leftWidth: number, rightWidth: number) => {
    // leftWidth is relative to the canvas.  We need to track left based on the window
    const sliderWidth = viewRect!.width - (leftWidth + rightWidth);
    const left = leftWidth + (sliderWidth / 2);
    const updatedLeft = left + viewRect!.left;

    setDividerLeftState(updatedLeft);
  };

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

  return (
    <>
      {/** Using the createPortal to */}
      {appContainer.current && ReactDOM.createPortal(
        (<>
          {/** The divider to move left and right. */}
          {viewRect && dividerLeftState && !isLockedState &&
            <DividerComponent sideL={dividerLeftState - viewRect.left} bounds={viewRect} onDragged={_onDividerMoved} />
          }
        </>), appContainer.current)
      }
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
            <>
              <LabeledSelect
                label="Left Model"
                value={leftModel}
                onChange={(v: Id64String) => {
                  setLeftModel(v);
                  setModelPair(v, rightModel); // ✅ API에 전달
                }}
                options={modelOptions}
              />
              <LabeledSelect
                label="Right Model"
                value={rightModel}
                onChange={(v: Id64String) => {
                  setRightModel(v);
                  setModelPair(leftModel, v); // ✅ API에 전달
                }}
                options={modelOptions}
              />
            </>
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