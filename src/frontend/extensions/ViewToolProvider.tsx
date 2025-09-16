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

    // 단일 토글 액션
    const toggleAction = ToolbarItemUtilities.createActionItem({
      id: "viewclip-toggle",
      icon: "C",
      label: "View Clip",
      // pressed 상태 연동
      isActive: this._enabled,
      // (선택) 상태 갱신 트리거가 있을 때 재평가되도록 sync id를 달아둡니다.
      //stateSyncIds: [SYNCID_VIEWCLIP],
      execute: async () => {
        const vp = IModelApp.viewManager.selectedView as ScreenViewport | undefined;
        if (!vp) return;

        const w = UiFramework.frontstages.activeFrontstageDef?.findWidgetDef("ViewClipWidget");

        if (!this._enabled) {
          // ON
          ViewClipApi.addExtentsClipRange(vp);
          w?.setWidgetState(WidgetState.Open);
          this._enabled = true;
        } else {
          // OFF
          ViewClipApi.clearClips(vp);
          w?.setWidgetState(WidgetState.Closed);
          this._enabled = false;
        }

        // ✅ toolbar 상태 즉시 반영
        SyncUiEventDispatcher.dispatchSyncUiEvent(SYNCID_VIEWCLIP);
      },
    });

    const swipeToggle = ToolbarItemUtilities.createActionItem({
      id: "swipe-toggle",
      icon: "icon-compare", // 아이콘은 원하는 걸로
      label: "Swiping Compare",
      execute: async () => {
        const w = UiFramework.frontstages.activeFrontstageDef?.findWidgetDef("SwipingComparisonWidget");
        if (!w) return;
        const opening = !this._swipeOpen;
        w.setWidgetState(opening ? WidgetState.Open : WidgetState.Closed);
        this._swipeOpen = opening;

        // 닫힐 때 안전 정리
        if (!opening) {
          const vp = IModelApp.viewManager.selectedView as ScreenViewport | undefined;
          if (vp) SwipingComparisonApi.disableModelsCompare(vp);
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
    if (location !== StagePanelLocation.Bottom)
      return [];

    return [{
      id: "ViewClipWidget",
      label: "View Clip",
      defaultState: WidgetState.Closed,   // ✅ 기본 닫힘 = 토글 OFF와 일치
      // AppUI 5.5에서 JSX 직접 제공 가능
      content: <ViewClipWidget />,
    }];
  }
}