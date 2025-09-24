import React from "react";
import {
  StagePanelLocation,
  StagePanelSection,
  UiItemsProvider,
  Widget,
  WidgetState,
  UiFramework,
} from "@itwin/appui-react";
import SettingsPanel from "./SettingsPanel";

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
      // Tab 패널
      content: (
        <div style={{position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:9999}}>
          <SettingsPanel
            onClose={() => {
              const def = UiFramework.frontstages.activeFrontstageDef?.findWidgetDef("SettingsWidget");
              def?.setWidgetState(WidgetState.Hidden);
          }}
        />
        </div>
      ),
    }];
  }
}