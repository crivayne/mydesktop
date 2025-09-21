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
import { goProjectHome,goLoginPanel } from "../services/navigation";
import { requestLogout } from "../services/AuthContext";

// SyncUi 이벤트 아이디 (아무 문자열로 유일하면 됨)
const SYNCID_VIEWCLIP = "viewclip:state-changed";


export class ViewToolProvider implements UiItemsProvider {
  public readonly id = "ViewToolProvider";
  private _enabled = false; // 기본 OFF
  private _swipeOpen = false; // SwipingComparisonWidget 토글 상태
  private _issuesOn = false;

  /** 공통 위젯 헬퍼 */
  private _openWidget(id: string) {
    const w = UiFramework.frontstages.activeFrontstageDef?.findWidgetDef(id);
    w?.setWidgetState(WidgetState.Open);
  }
  private _hideWidget(id: string) {
    const w = UiFramework.frontstages.activeFrontstageDef?.findWidgetDef(id);
    w?.setWidgetState(WidgetState.Hidden);
  }

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
    
    // 공통 정리 함수 (뷰/위젯 상태 정리)
    const cleanupViewAndWidgets = () => {
      const vp = IModelApp.viewManager.selectedView as ScreenViewport | undefined;
      try {
        if (vp) {
          // View Clip 해제
          ViewClipApi.clearClips(vp);
          // Swiping 정리
          SwipingComparisonApi.setEnabled(false);
          SwipingComparisonApi.disableModelsCompare(vp);
        }
      } catch {}

      // 관련 위젯 숨김
      UiFramework.frontstages.activeFrontstageDef
        ?.findWidgetDef("ViewClipWidget")
        ?.setWidgetState(WidgetState.Hidden);
      UiFramework.frontstages.activeFrontstageDef
        ?.findWidgetDef("SwipingComparisonWidget")
        ?.setWidgetState(WidgetState.Hidden);

      // 내부 상태 플래그 리셋
      this._enabled = false;
      this._swipeOpen = false;
    };

    // ====== Main 그룹 (맨 위) ======
    const openSnapshot = ToolbarItemUtilities.createActionItem({
      id: "main-open-snapshot",
      icon: "O",
      label: "Snapshot Open",
      execute: async () => {
        // 웹 전용 UX를 염두: 일단 버튼만. 후속 작업에서 파일 선택/라우팅 연결.
        // TODO: 파일 선택 다이얼로그/라우팅 연결 지점.
        // eslint-disable-next-line no-console
        console.log("[Main] Snapshot Open clicked");
      },
    });

    const openReality = ToolbarItemUtilities.createActionItem({
      id: "main-reality-data",
      icon: "R",
      label: "Reality Data",
      execute: async () => {
        // TODO: Reality Data 브라우저/연결 UI로 확장 예정.
        // eslint-disable-next-line no-console
        console.log("[Main] Reality Data clicked");
      },
    });

    const openSettings = ToolbarItemUtilities.createActionItem({
      id: "main-settings",
      icon: "⚙",
      label: "Setting",
      execute: async () => {
        // 기존 세팅 패널 열기 (앱 내 위젯 id가 다르면 아래 후보에서 하나로 맞춰줘)
        const candidates = ["SettingsWidget"];
        for (const id of candidates) {
          const def = UiFramework.frontstages.activeFrontstageDef?.findWidgetDef(id);
          if (def) {
            def.setWidgetState(WidgetState.Open);
            // 하단 다른 패널은 가려 UX 충돌 방지 (선택)
            this._hideWidget("ViewClipWidget");
            this._hideWidget("SwipingComparisonWidget");
            return;
          }
        }
        // eslint-disable-next-line no-console
        console.warn("[Main] Settings widget not found. Please map its widget id.");
      },
    });

    const goBack = ToolbarItemUtilities.createActionItem({
      id: "main-back",
      icon: "⟲",
      label: "Back",
      execute: async () => {
        // 뷰 정리(충돌 방지): ViewClip/Swiping 상태 모두 해제 후 이동
        const ok = window.confirm("홈으로 이동하시겠습니까?");
        if (!ok) return;

        cleanupViewAndWidgets();
        // 프로젝트/사이트 화면으로 이동
        goProjectHome();
      },
    });

    const btnLogout = ToolbarItemUtilities.createActionItem({
      id: "main-logout",
      icon: "X", // 가용 아이콘으로 교체 가능
      label: "Logout",
      execute: async () => {
        const ok = window.confirm("로그아웃하고 로그인 화면으로 이동할까요?");
        if (!ok) return;

        cleanupViewAndWidgets();

        // 🔸 우리 앱 방식의 로그아웃
        requestLogout();          // 컨텍스트가 setAuth(undefined) 수행 + 저장소 ‘null’

        // 로그인 패널로
        goLoginPanel();
      },
    });

    const mainGroup = ToolbarItemUtilities.createGroupItem({
      id: "main-group",
      label: "Main",
      icon: "M",
      groupPriority: 80, // ⬅️ 숫자 작을수록 위쪽/앞쪽
      items: [openSnapshot, openReality, openSettings, goBack, btnLogout],
    });
  
    // ====== View Tools 그룹 ======  
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
    const viewToolsGroup = ToolbarItemUtilities.createGroupItem({
      id: "view-tools-group",
      label: "View Tools",
      icon: "VT",
      groupPriority: 90, // 숫자가 크면 오른쪽/뒤쪽에 배치
      items: [toggleAction, swipeToggle]
    });

    // ✅ MK(마크) 그룹: Issues 토글
    const issuesToggle = ToolbarItemUtilities.createActionItem({
      id: "issues-toggle",
      icon: "MK",         // 원하시는 아이콘 문자열/스프라이트로 교체 가능
      label: "Issues",
      execute: async () => {
        const front = UiFramework.frontstages.activeFrontstageDef;
        const issuesW = front?.findWidgetDef("IssuesWidget"); // ← 위젯 id 확인됨
        const opening = !this._issuesOn;

        if (opening) {
          issuesW?.setWidgetState(WidgetState.Open);   // 패널/위젯 표시 (mount)
          this._issuesOn = true;
        } else {
          issuesW?.setWidgetState(WidgetState.Hidden); // 패널/위젯 숨김 (unmount)
          this._issuesOn = false;
        }
      },
    });

    const mkGroup = ToolbarItemUtilities.createGroupItem({
      id: "mark-group",
      label: "Mark",
      icon: "MK",
      groupPriority: 99, // 제일 아래로
      items: [issuesToggle],
    });

    return [mainGroup, viewToolsGroup, mkGroup];
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