import * as React from "react";
import {
  CommonToolbarItem,
  ToolbarItemUtilities,
  ToolbarUsage,
  ToolbarOrientation,
  UiItemsProvider,
  StagePanelLocation,
  StagePanelSection,
  Widget,
  WidgetState,
  UiFramework,
  SyncUiEventDispatcher,
} from "@itwin/appui-react";
import { IModelApp, ScreenViewport } from "@itwin/core-frontend";
import ViewClipApi from "./viewclip/ViewClipApi";
import { ViewClipWidget } from "./viewclip/ViewClipWidget";
import * as SwipingComparisonApi from "./SwipingComparison/SwipingComparisonApi";
import { SwipingComparisonWidget } from "./SwipingComparison/SwipingComparisonWidget";

// SyncUi 이벤트 아이디 (아무 문자열로 유일하면 됨)
const SYNCID_VIEWCLIP = "viewclip:state-changed";


export class ViewToolProvider implements UiItemsProvider {
  public readonly id = "ViewToolProvider";
  private _enabled = false; // 기본 OFF
  private _swipeOpen = false; // SwipingComparisonWidget 토글 상태


  /** 툴바에 토글 버튼 추가 */
  public provideToolbarItems(
    _stageId: string,
    _stageUsage: string,
    toolbarUsage: ToolbarUsage,
    toolbarOrientation: ToolbarOrientation
  ): CommonToolbarItem[] {
    // ✅ 왼쪽 세로 툴바(= ContentManipulation / Vertical)에만 아이템 제공
    if (toolbarUsage !== ToolbarUsage.ContentManipulation || toolbarOrientation !== ToolbarOrientation.Vertical)
      return [];

  // View Clip 토글 버튼 (전역 플래그/정리 포함)
  const toggleAction = ToolbarItemUtilities.createActionItem({
    id: "viewclip-toggle",
    icon: "C",
    label: "View Clip",
    isActive: this._enabled, // pressed 표시는 불가한 버전
    execute: async () => {
      const vp = IModelApp.viewManager.selectedView as ScreenViewport | undefined;
      if (!vp) return;

      const clipW  = UiFramework.frontstages.activeFrontstageDef?.findWidgetDef("ViewClipWidget");
      const swipeW = UiFramework.frontstages.activeFrontstageDef?.findWidgetDef("SwipingComparisonWidget");

      if (!this._enabled) {
        // ▶ View Clip ON → Swiping OFF
        SwipingComparisonApi.setEnabled(false);
        SwipingComparisonApi.disableModelsCompare(vp);
        swipeW?.setWidgetState(WidgetState.Hidden);
        this._swipeOpen = false;

        ViewClipApi.addExtentsClipRange(vp);
        clipW?.setWidgetState(WidgetState.Open);  // 하단 패널 해당 탭으로
        this._enabled = true;
      } else {
        // ◀ View Clip OFF
        ViewClipApi.clearClips(vp);
        clipW?.setWidgetState(WidgetState.Hidden); // 하단 패널 숨김
        this._enabled = false;
      }
      SyncUiEventDispatcher.dispatchSyncUiEvent(SYNCID_VIEWCLIP);
    },
  });

  // Swiping Compare 토글 버튼 (전역 플래그/정리 포함)
  const swipeToggle = ToolbarItemUtilities.createActionItem({
    id: "swipe-toggle",
    icon: "S",
    label: "Swiping Compare",
    execute: async () => {
      const vp = IModelApp.viewManager.selectedView as ScreenViewport | undefined;
      if (!vp) return;

      const clipW  = UiFramework.frontstages.activeFrontstageDef?.findWidgetDef("ViewClipWidget");
      const swipeW = UiFramework.frontstages.activeFrontstageDef?.findWidgetDef("SwipingComparisonWidget");

      const opening = !this._swipeOpen;
      if (opening) {
        // ▶ Swiping ON → View Clip OFF
        ViewClipApi.clearClips(vp);
        clipW?.setWidgetState(WidgetState.Hidden);
        this._enabled = false;

        SwipingComparisonApi.setEnabled(true);
        swipeW?.setWidgetState(WidgetState.Open); // 하단 패널 해당 탭으로
        this._swipeOpen = true;
      } else {
        // ◀ Swiping OFF
        swipeW?.setWidgetState(WidgetState.Hidden); // 하단 패널 숨김
        this._swipeOpen = false;
        SwipingComparisonApi.setEnabled(false);
        SwipingComparisonApi.disableModelsCompare(vp);
      }
    },
  });

    // 앞으로 여기로 기능을 더 붙일 계획이라면 그룹으로 감싸는 게 좋아
    const group = ToolbarItemUtilities.createGroupItem({
      id: "view-tools-group",
      label: "View Tools",
      icon: "VT",
      groupPriority: 90, // 숫자가 크면 오른쪽/뒤쪽에 배치
      items: [toggleAction, swipeToggle]
    });

    return [group];
  }

  /** (하단) 패널에 위젯 추가 – 이미 만든 위젯 사용 */
  public provideWidgets(
    _stageId: string,
    _stageUsage: string,
    location: StagePanelLocation,
    _section?: StagePanelSection
  ): ReadonlyArray<Widget> {
    const widgets: Widget[] = [];

    if (location === StagePanelLocation.Bottom) {
      widgets.push({
        id: "ViewClipWidget",
        label: "View Clip",
        defaultState: WidgetState.Hidden,
        content: <ViewClipWidget />,
      });

      widgets.push({
        id: "SwipingComparisonWidget",
        label: "Swiping Comparison Selector",
        defaultState: WidgetState.Hidden,             // 초기 Off
        content: <SwipingComparisonWidget appContainerId="AppContainer" />, // id 못찾으면 위젯 내부가 viewport 부모로 fallback
      });
    }

    return widgets;
  }
}