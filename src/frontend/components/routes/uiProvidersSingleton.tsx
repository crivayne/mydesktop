// src/frontend/components/routes/uiProvidersSingleton.tsx
import React from "react";
import {
  ViewerNavigationToolsProvider,
  ViewerContentToolsProvider,
  ViewerStatusbarItemsProvider,
} from "@itwin/desktop-viewer-react";
import { MeasureToolsUiItemsProvider } from "@itwin/measure-tools-react";
import {
  createTreeWidget,
  ModelsTreeComponent,
  CategoriesTreeComponent,
} from "@itwin/tree-widget-react";
import {
  createPropertyGrid,
  AncestorsNavigationControls,
  CopyPropertyTextContextMenuItem,
  ShowHideNullValuesSettingsMenuItem,
} from "@itwin/property-grid-react";

// ViewerRoute와 같은 폴더 기준으로 selectionStorage 위치가 이 경로였음
import { unifiedSelectionStorage } from "../../../selectionStorage";

import { ViewToolProvider } from "../../extensions/ViewToolProvider";
import { SettingsWidgetProvider } from "../../extensions/settings/SettingsWidget";
import { IssuesWidgetProvider } from "../../extensions/issues/IssuesWidget";
import { DocumentsWidgetProvider } from "../../extensions/documents/DocumentsWidget";

// 베이스 / 이슈 분리
let _base: any[] | undefined;
let _issues: any | undefined;

export function getBaseUiProviders(): any[] {
  if (_base) return _base;

  // 클래스형 Provider는 new 한번씩만
  const nav = new ViewerNavigationToolsProvider();
  const content = new ViewerContentToolsProvider({ vertical: { measureGroup: false } });
  const status = new ViewerStatusbarItemsProvider();
  const measure = new MeasureToolsUiItemsProvider();
  const viewTool = new ViewToolProvider();
  const settings = new SettingsWidgetProvider();
  const documents = new DocumentsWidgetProvider(); 

  // 오브젝트형 Provider는 고정 객체로
  const treeProvider: any = {
    id: "TreeWidgetUIProvider",
    getWidgets: () => [
      createTreeWidget({
        trees: [
          {
            id: ModelsTreeComponent.id,
            getLabel: () => ModelsTreeComponent.getLabel(),
            render: (props: any) => (
              <ModelsTreeComponent
                getSchemaContext={(iModel: any) => iModel.schemaContext}
                density={props.density}
                selectionStorage={unifiedSelectionStorage}
                selectionMode="extended"
                onPerformanceMeasured={props.onPerformanceMeasured}
                onFeatureUsed={props.onFeatureUsed}
              />
            ),
          },
          {
            id: CategoriesTreeComponent.id,
            getLabel: () => CategoriesTreeComponent.getLabel(),
            render: (props: any) => (
              <CategoriesTreeComponent
                getSchemaContext={(iModel: any) => iModel.schemaContext}
                density={props.density}
                selectionStorage={unifiedSelectionStorage}
                onPerformanceMeasured={props.onPerformanceMeasured}
                onFeatureUsed={props.onFeatureUsed}
              />
            ),
          },
        ],
      }),
    ],
  };

  const propertyProvider: any = {
    id: "PropertyGridUIProvider",
    getWidgets: () => [
      createPropertyGrid({
        autoExpandChildCategories: true,
        ancestorsNavigationControls: (p: any) => <AncestorsNavigationControls {...p} />,
        contextMenuItems: [(p: any) => <CopyPropertyTextContextMenuItem {...p} />],
        settingsMenuItems: [
          (p: any) => <ShowHideNullValuesSettingsMenuItem {...p} persist={true} />,
        ],
      }),
    ],
  };

  const issues = getIssuesProvider();

  _base = [
    nav,
    content,
    status,
    treeProvider,
    propertyProvider,
    measure,
    viewTool,
    settings,
    documents,
    issues,
  ];
  return _base;
}

// 분리 
export function getIssuesProvider(): any {
  if (_issues) return _issues;
  _issues = new IssuesWidgetProvider(); // ← **단일 인스턴스**
  return _issues;
}