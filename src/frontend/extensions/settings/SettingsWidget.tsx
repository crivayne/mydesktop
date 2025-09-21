import React from "react";
import {
  StagePanelLocation,
  StagePanelSection,
  UiItemsProvider,
  Widget,
  WidgetState,
  UiFramework,
} from "@itwin/appui-react";
import RenderSettings from "../settings/RenderSettings";

export class SettingsWidgetProvider implements UiItemsProvider {
  public readonly id = "SettingsWidgetProvider";

  public provideWidgets(
    _stageId: string,
    _stageUsage: string,
    location: StagePanelLocation,
    _section?: StagePanelSection
  ): ReadonlyArray<Widget> {
    if (location !== StagePanelLocation.Right)
      return [];

    return [{
      id: "SettingsWidget",                // 이 id로 열고 닫습니다
      label: "Settings",
      defaultState: WidgetState.Hidden,
      // 위젯이 열리면 마운트되므로 RenderSettings는 항상 open=true
      content: (
        <RenderSettings
          open={true}
          onClose={() => {
            const def = UiFramework.frontstages.activeFrontstageDef?.findWidgetDef("SettingsWidget");
            def?.setWidgetState(WidgetState.Hidden);
          }}
        />
      ),
    }];
  }
}