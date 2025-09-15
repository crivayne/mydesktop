import * as React from "react";
import {
  CommonToolbarItem, ToolbarItemUtilities, ToolbarUsage, ToolbarOrientation,
  UiItemsProvider, StagePanelLocation, StagePanelSection, Widget, WidgetState,
  UiFramework,
} from "@itwin/appui-react";
import { IModelApp, ScreenViewport } from "@itwin/core-frontend";
import ViewClipApi from "./ViewClipApi";
import  {ViewClipWidget}  from "./ViewClipWidget"; // 네가 올린 위젯

export class ViewClipToggleProvider implements UiItemsProvider {
  public readonly id = "ViewClipToggleProvider";
  private _enabled = false; // 클립 켜짐 상태

  /** 툴바에 토글 버튼 추가 */
  public provideToolbarItems(
    _stageId: string,
    _stageUsage: string,
    toolbarUsage: ToolbarUsage,
    _toolbarOrientation: ToolbarOrientation
  ): CommonToolbarItem[] {
    if (toolbarUsage !== ToolbarUsage.ViewNavigation) return [];

    const item = ToolbarItemUtilities.createActionItem({
      id: "viewclip-toggle",  
      icon: "icon-section-tool", // 대체: "icon-crop" 등
      label: "View Clip",
      
      execute: async () => {
        const vp = IModelApp.viewManager.selectedView as ScreenViewport | undefined;
        if (!vp) return;

        // 패널 위젯 핸들 얻기
        const def = UiFramework.frontstages.activeFrontstageDef?.findWidgetDef("ViewClipWidget");

        if (!this._enabled) {
          // ON: 기본 Extents 박스 클립 + 패널 열기
          ViewClipApi.addExtentsClipRange(vp);
          if (def) def.setWidgetState(WidgetState.Open);
          this._enabled = true;
        } else {
          // OFF: 클립 제거 + 패널 닫기
          ViewClipApi.clearClips(vp);
          if (def) def.setWidgetState(WidgetState.Closed);
          this._enabled = false;
        }

        // 버튼 프레스 상태 반영
        UiFramework.dispatchActionToStore("SET_TOOL_CLICKED", {} as any); // 강제 리프레시 트릭(없어도 동작)
      },
    });

    return [item];
  }

  /** (하단) 패널에 위젯 추가 – 네가 올린 위젯 그대로 사용 */
  public provideWidgets(_stageId: string, _stageUsage: string, location: StagePanelLocation, _section?: StagePanelSection): ReadonlyArray<Widget> {
    if (location !== StagePanelLocation.Bottom) return [];
    return [{
      id: "ViewClipWidget",
      label: "View Clip",
      defaultState: WidgetState.Closed, // 기본은 닫힘(토글 눌렀을 때 열어줌)
      content: <ViewClipWidget />,
    }];
  }
}