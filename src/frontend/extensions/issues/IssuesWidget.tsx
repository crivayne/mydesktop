/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  StagePanelLocation,
  StagePanelSection,
  UiItemsProvider,
  useActiveIModelConnection,
  useActiveViewport,
  Widget,
  WidgetState,
  UiFramework,
} from "@itwin/appui-react";
import type { WidgetStateChangedEventArgs } from "@itwin/appui-react";
import { Angle, Point3d, Vector3d } from "@itwin/core-geometry";
import { Alert, Anchor, IconButton, LabeledSelect, ProgressRadial, SelectOption, Tab, Table, Tabs, Text, Tile,Button, Modal, ModalButtonBar, InputGroup } from "@itwin/itwinui-react";
import { IModelApp, PrimitiveTool, BeButtonEvent, EventHandled, Viewport } from "@itwin/core-frontend";
import type { IModelConnection } from "@itwin/core-frontend";
import { MarkerPinDecorator } from "../issues/marker-pin/MarkerPinDecorator";
import IssuesApi, { LabelWithId } from "./IssuesApi";
import IssuesClient, { AttachmentMetadataGet, AuditTrailEntryGet, CommentGetPreferReturnMinimal, IssueDetailsGet, IssueGet, IssueChange } from "./IssuesClient";
import { useAuth } from "../../services/AuthContext";
import "./Issues.scss";

// 구/신버전 호환 리드로우
function safeRequestRedraw(vp?: Viewport | any) {
  if (!vp || vp.isDisposed) return;
  // 신버전: Viewport.requestRedraw()
  if ((vp as any).requestRedraw) {
    (vp as any).requestRedraw();
    return;
  }
  // 구버전 폴백: 직접 렌더는 피하고 무효화만
  try { vp.invalidateDecorations?.(); } catch {}
  try { vp.invalidateScene?.(); } catch {}
  try { vp.invalidateRenderPlan?.(); } catch {}
  // renderFrame() 직접 호출은 크래시 원인이라 의도적으로 호출하지 않음
}

const IssuesWidget = () => {
  type WidgetStateChangedArgs = {
    widgetState: WidgetState;
    widgetDef?: { id?: string };
    // 일부 버전에선 widgetId로만 줌
    widgetId?: string;
  };
  
  type Row = { prop: string; val: string | undefined };

  const thumbnails: Map<string, Blob> = new Map<string, Blob>();

  // useAuth()가 null일 수 있으니 안전하게 받기 + localStorage 폴백
  const authCtx = useAuth(); // null일 수 있음
  const auth = authCtx?.auth ?? (() => {
    try { return JSON.parse(localStorage.getItem("auth") || "null") || undefined; }
    catch { return undefined; }
  })();
  const isAdmin = auth?.role === "admin";
  const draftIssuesRef = useRef<IssueGet[]>([]);
  const siteId = React.useMemo(()=> localStorage.getItem("siteId") || "", []); //ViewerRoute에서 로드 시 siteId를 localStorage에 한번 넣어두면 위젯에서 꺼내 쓰기
  const iModelConnection = useActiveIModelConnection();
  const viewport = useActiveViewport();
  const [contextId, setContextId] = useState<string>();
  // 이미 로드(또는 시도)한 썸네일 ID 기억용
  const loadedThumbIdsRef = useRef<Set<string>>(new Set());
  // 동시에 같은 걸 또 받지 않도록 in-flight 가드
  const loadingThumbIdsRef = useRef<Set<string>>(new Set());
  /** All issues */
  const allIssues = useRef<IssueGet[]>([]);
  /** The issues currently being displayed */
  const [currentIssues, setCurrentIssues] = useState<IssueGet[]>([]);
  const [previewImages, setPreviewImages] = useState<Record<string, Blob>>({});
  /** The pictures / attachments that are associated with the issue */
  const [issueAttachmentMetaData, setIssueAttachmentMetaData] = useState<Record<string, AttachmentMetadataGet[]>>({});
  /** The blobs for each issue's attachments */
  const [issueAttachments, setIssueAttachments] = useState<Record<string, Blob[]>>({});
  /** The comments associated with each issue */
  const [issueComments, setIssueComments] = useState<Record<string, CommentGetPreferReturnMinimal[]>>({});
  /** The audit trail associated with each issue */
  const [issueAuditTrails, setIssueAuditTrails] = useState<Record<string, AuditTrailEntryGet[]>>({});
  /** The Issue to display when the user selects, if undefined, none is shown */
  const [currentIssue, setCurrentIssue] = useState<IssueGet>();
  /** The Elements linked to the issue */
  const [currentLinkedElements, setLinkedElements] = useState<LabelWithId[]>();
  /** The active tab when the issue is being shown, -1 for none */
  const [activeTab, setActiveTab] = useState<number>(0);
  /** The State filter. */
  const [issueState, setIssueState] = useState<string>("all");
  /** The type filter. */
  const [issueFilter, setIssueType] = useState<string>("all");
  /** The decorator used for displaying issue markers */
  const [issueDecorator] = React.useState<MarkerPinDecorator>(() => {
    return IssuesApi.setupDecorator();
  });
  //변경분 저장용
  const [pendingIssues, setPendingIssues] = React.useState<IssueChange[]>([]);
  // 로딩 스테이트
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  //생성 및 수정
  const [showAdd, setShowAdd] = useState(false);
  const [newSubject, setNewSubject] = useState("");
  const [showEdit, setShowEdit] = useState(false);
  const [editSubject, setEditSubject] = useState("");
  const [editState, setEditState] = useState<"Open"|"Closed"|"Draft">("Open"); // 워크플로
  const [editStatus, setEditStatus] = useState<"Unresolved"|"Resolved"|"Verified">("Unresolved"); // 업무상태
  const [editDescription, setEditDescription] = useState("");
  const [editElementId, setEditElementId] = useState(""); // 원본 elementId 문자열
  const [editXYZ, setEditXYZ] = useState<{x?:number,y?:number,z?:number}>({});
  const [editLinks, setEditLinks] = useState<string[]>([]); // 링크된 elementId 배열
  const [editAssignee, setEditAssignee] = useState("");

  //마커
  const [markerVersion, setMarkerVersion] = useState(0);
  
  //Status 추가 + 임시데이터유지
  const [issueStatus, setIssueStatus] = useState<string>("all");
  //리스트 진입시
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [leaveAction, setLeaveAction] = useState<null | (()=>void)>(null);

  // open 상태 감지
  const useIsIssuesOpen = () => {
    const [isOpen, setIsOpen] = React.useState<boolean>(() => {
      const wid = UiFramework.frontstages.activeFrontstageDef?.findWidgetDef("IssuesWidget");
      const st = wid?.state;
      return st === WidgetState.Open || (WidgetState as any).Visible === st;
    });

    React.useEffect(() => {
      const ev: any = UiFramework.frontstages?.onWidgetStateChangedEvent;
      if (!ev?.addListener) return;
      const off = ev.addListener((args: any) => {
        const wid = args?.widgetDef?.id ?? args?.widgetId;
        if (wid !== "IssuesWidget") return;
        const open = args.widgetState === WidgetState.Open ||
                    (WidgetState as any).Visible === args.widgetState;
        setIsOpen(open);
      });
      return () => { try { off?.(); } catch {} };
    }, []);

    return isOpen;
  };
  
  const isOpen = useIsIssuesOpen();

  /** Initialize Decorator */
  useEffect(() => {
    if (!isOpen) return;
    IssuesApi.enableDecorations(issueDecorator);
    return () => {
      IssuesApi.clearDecoratorPoints(issueDecorator);
      IssuesApi.disableDecorations(issueDecorator);
    };
  }, [issueDecorator, isOpen]);

  // --- 새 Viewport가 열릴 때마다 데코레이터 재부착 + 마커 리드로우
  useEffect(() => {
    if (!isOpen) return;
    const vm = IModelApp?.viewManager as any;
    if (!vm) return;

    const handlers: Array<() => void> = [];

    // 공통 처리 로직
    const bump = (vp?: any) => {
      try {
        if (!isOpen) return;
        IssuesApi.enableDecorations(issueDecorator);
        setMarkerVersion((v) => v + 1);

        // vp 추출: (1) 직접 vp (2) args.current (3) args.viewport
        const cand = vp?.invalidateRenderPlan ? vp
          : vp?.current?.invalidateRenderPlan ? vp.current
          : vp?.viewport?.invalidateRenderPlan ? vp.viewport
          : undefined;

        if (!cand || cand.isDisposed) return;
        cand.invalidateRenderPlan?.();
        safeRequestRedraw(cand);
      } catch {/* swallow */}
    };

    // onViewOpen / onViewAdded는 viewport 자체를 넘기는 버전이 많음
    if (vm.onViewOpen?.addListener) {
      const off = vm.onViewOpen.addListener((vp: any) => bump(vp));
      handlers.push(() => { try { off?.(); } catch {} });
    }
    if (vm.onViewAdded?.addListener) {
      const off = vm.onViewAdded.addListener((vp: any) => bump(vp));
      handlers.push(() => { try { off?.(); } catch {} });
    }
    // onSelectedViewportChanged는 args 시그니처(버전별 상이)
    if (vm.onSelectedViewportChanged?.addListener) {
      const off = vm.onSelectedViewportChanged.addListener((...args: any[]) => {
        const a = args[0];
        const vp = a?.current ?? a?.viewport ?? a; // 가능한 후보
        bump(vp);
      });
      handlers.push(() => { try { off?.(); } catch {} });
    }

    return () => handlers.forEach(fn => fn());
  }, [issueDecorator, isOpen]);

  // --- 활성 Viewport가 바뀌면 재부착 + 한 프레임 렌더
  useEffect(() => {
    if (!isOpen || !viewport || viewport.isDisposed) return;
    IssuesApi.enableDecorations(issueDecorator);
    setMarkerVersion((v) => v + 1);
    viewport.invalidateRenderPlan?.();
    safeRequestRedraw(viewport);
  }, [viewport, issueDecorator, isOpen]);

  /** Set the preview Images on issue load */
  useEffect(() => {
    let cancelled = false;

    (async () => {
      for (const issue of currentIssues) {
        const id = issue.id?.toString();
        if (!id) continue;
        if (id.startsWith("tmp-")) continue;                        // 임시 이슈는 스킵
        if (previewImages[id]) continue;                            // 이미 state에 있음
        if (loadedThumbIdsRef.current.has(id)) continue;            // 과거에 한 번 처리함
        if (loadingThumbIdsRef.current.has(id)) continue;           // 지금 받고 있는 중

        try {
          loadingThumbIdsRef.current.add(id);

          // 1) 서버 메타에서 "미리보기"만 가져옴(0번 첨부)
          const meta = await IssuesClient.getIssueAttachments(id);
          const previewAttachmentId = meta?.attachments?.[0]?.id;

          // 첨부 메타(나머지)는 캐시에 저장
          if (!cancelled) {
            setIssueAttachmentMetaData(prev => ({
              ...prev,
              [id]: meta?.attachments?.slice(1) ?? [],
            }));
          }

          if (!previewAttachmentId) {
            // 미리보기 없음: 그래도 "처리됨"으로 마킹해서 무한 재시도 방지
            loadedThumbIdsRef.current.add(id);
            continue;
          }

          // 2) 썸네일 Blob 다운로드
          const blob = await IssuesClient.getAttachmentById(id, previewAttachmentId);
          if (!blob) {
            loadedThumbIdsRef.current.add(id);
            continue;
          }

          // 3) 서버의 1x1 투명 PNG 플레이스홀더 회피
          const isTinyPlaceholder = blob.type === "image/png" && blob.size <= 100;
          if (!cancelled && !isTinyPlaceholder) {
            setPreviewImages(prev => ({ ...prev, [id]: blob }));
          }

          // 결과와 무관하게 “처리됨” 마크(무한 루프 방지)
          loadedThumbIdsRef.current.add(id);
        } finally {
          loadingThumbIdsRef.current.delete(id);
        }
      }
    })();

    return () => { cancelled = true; };
    // previewImages를 dep에 넣는 이유: 어떤 이슈의 썸네일이 세팅되면
    // 다른 이슈들에 대해서는 여전히 위 가드 덕에 중복 네트워크 없이 안전히 진행됨
  }, [currentIssues, previewImages]);

  const applyView = useCallback(async (issue: IssueGet) => {
    if (!viewport) return;
    const vp = viewport;

    // 1) cameraView 있으면 그대로 적용
    if (vp.view.is3d()) {
      const cameraView = issue.modelView?.cameraView;
      if (cameraView) {
        const eyePoint = Point3d.fromJSON(cameraView.viewPoint);
        const upVector = Vector3d.fromJSON(cameraView.up);
        const directionVector = Point3d.fromJSON(cameraView.direction);
        const fov = Angle.degreesToRadians(cameraView.fieldOfView!);
        const targetPoint = eyePoint.plus(directionVector);
        vp.view.lookAt({ eyePoint, targetPoint, upVector, lensAngle: Angle.createRadians(fov) });
        vp.synchWithView({ animateFrustumChange: true });
        return;
      }
    }

    // 2) linked elements 있으면 그걸로 줌
    const raw = issue.sourceEntity?.iModelElement?.elementId as string | undefined;
    const ids = IssuesApi.parseElementIds(raw);
    if (ids.length) {
      await viewport.zoomToElements(ids, { animateFrustumChange: true });
      return;
    }

    // 3) modelPin만 있으면 pin 주변으로 줌
    const p = issue.modelPin?.location;
    if (p) {
      const pad = 2.0;
      const min = Point3d.create(p.x - pad, p.y - pad, p.z - pad);
      const max = Point3d.create(p.x + pad, p.y + pad, p.z + pad);
      await viewport.zoomToVolume({ low: min, high: max }, { animateFrustumChange: true });
    }
  }, [viewport]);

  /** Create the issue marker icon, then add the pin at the issue location */
  useEffect(() => {
    async function createMarker(issue: IssueGet) {
      // 0) 좌표가 없으면 linked elementId들(bis.Element 배열) bbox 중심으로 보정
      if (!issue.modelPin?.location && iModelConnection) {
        const raw = issue.sourceEntity?.iModelElement?.elementId as string | undefined;

        // KeySet JSON 또는 공백구분 문자열 둘 다 허용
        const ids = (() => {
          if (!raw) return [] as string[];
          try {
            const kj = JSON.parse(raw);
            const arr = kj?.instanceKeys?.["bis.Element"];
            if (Array.isArray(arr)) return arr.map(String);
          } catch {
            return raw.split(/\s+/).filter(Boolean);
          }
          return [];
        })();

        if (ids.length > 0) {
          try {
            const infos = await IssuesApi.getElementInfoByIds(iModelConnection, ids);
            const center = IssuesApi.centerOf(infos);
            if (center) issue.modelPin = { location: center };
          } catch {
            // bbox가 없는(non-geometric) 요소면 마커 생략
          }
        }
      }

      // 1) 좌표가 없다면: 뷰가 살아있으면 뷰 중심에 임시 핀 생성
      if (!issue.modelPin?.location) {
        const vp2 = IModelApp?.viewManager?.selectedView;
        if (!vp2) return; // 뷰조차 없으면 이번엔 스킵(다음 사이클에 다시 시도)
        const fr = vp2.view.computeFitRange();
        const center = fr.low.interpolate(0.5, fr.high);
        issue.modelPin = { location: center };
      }

      // 2) 이하 기존 svg/icon 생성 + addDecoratorPoint 동일
      const parser = new DOMParser();
      const svgMap: { [key: string]: HTMLImageElement } = {};
      const issue_marker: string = `
      <svg viewBox="0 0 32 32" width="40" height="40" xmlns="http://www.w3.org/2000/svg"><path d="m25 0h-18a5 5 0 0 0 -5 5v18a5 5 0 0 0 5 5h5v.00177l4 3.99823 4-3.99823v-.00177h5a5 5 0 0 0 5-5v-18a5 5 0 0 0 -5-5z" fill="#fff" fill-rule="evenodd"/>
        <path id="fill" d="m25 1a4.00453 4.00453 0 0 1 4 4v18a4.00453 4.00453 0 0 1 -4 4h-18a4.00453 4.00453 0 0 1 -4-4v-18a4.00453 4.00453 0 0 1 4-4z" fill="#008be1"/>
        <path id="icon" d="m10.8125 5h1.125v18h-1.125zm12.375 6.75h-10.125v-6.75h10.125l-4.5 3.375z" fill="#fff"/>
      </svg>`;
      const fillColor = issueStatusColor(issue);
      let svg = svgMap[fillColor];
      if (!svg) {
        const imgXml = parser.parseFromString(issue_marker, "application/xml");

        /** set the background fill color */
        const fill = imgXml.getElementById("fill");
        if (fill) {
          fill.setAttribute("fill", fillColor);
        }

        /** set the foreground (icon flag) color */
        const icon = imgXml.getElementById("icon");
        if (icon) {
          const textColor = buildForegroundColor(fillColor);
          if (textColor) {
            icon.setAttribute("fill", textColor);
          }
        }

        const svgString = new XMLSerializer().serializeToString(imgXml);
        const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
        svg = new Image(40, 40);
        svg.src = URL.createObjectURL(blob);
        await svg.decode();
        svgMap[fillColor] = svg;
      }

      /** Add the point to the decorator */
      IssuesApi.addDecoratorPoint(issueDecorator, issue, svg, issue.number, issue.subject, (iss: any) => {
        applyView(iss)
          .catch((error) => {
            // eslint-disable-next-line no-console
            console.error(error);
          });
        setActiveTab(0);
        setCurrentIssue(iss);
      });
    }

    /** Clear the current points */
    IssuesApi.clearDecoratorPoints(issueDecorator);

    for (const issue of currentIssues.filter(i => (i.status || '').toLowerCase() !== 'deleted')) {
      void createMarker(issue);
    }

  }, [applyView, currentIssues, issueDecorator, markerVersion,iModelConnection]);

  /** Returns a color corresponding to the status of the issue */
  const issueStatusColor = (issue: IssueGet) => {
    switch (String(issue.status || "").toLowerCase()) {
      case "unresolved": return "#F18812"; // 주황
      case "verified":   return "#0088FF"; // 파랑
      case "resolved":   return "#56A91C"; // 초록
      default:           return "#D30A0A"; // 그 외/미정
    }
  };

  /** Helper to determine text color on the basis of background hex color. */
  const buildForegroundColor = (markerFillColor: string): string | undefined => {
    if (!markerFillColor) return;
    if (markerFillColor[0] === "#") {
      markerFillColor = markerFillColor.slice(1);
    }
    const r = parseInt(markerFillColor.slice(0, 2), 16);
    const g = parseInt(markerFillColor.slice(2, 4), 16);
    const b = parseInt(markerFillColor.slice(4, 6), 16);
    const yiq = (r * 299 + g * 587 + b * 114) / 1000;

    // All focus on yellow only
    return yiq >= 190 ? "#000000" : "#FFFFFF";
  };

  // A. currentIssue가 바뀌면 링크 캐시 무효화
  useEffect(() => {
    setLinkedElements(undefined);
  }, [currentIssue?.id]);

  // B. getLinkedElements: 캐시 스킵 조건 삭제(혹은 '같은 이슈일 때만 스킵')
  const getLinkedElements = useCallback(async () => {
    /** Don't refetch if we have already received the linked elements */
    if (!iModelConnection || !currentIssue)
      return;

    const raw = currentIssue.sourceEntity?.iModelElement?.elementId as string | undefined;
    const ids = IssuesApi.parseElementIds(raw); // ← 공용 파서 사용
    if (ids.length === 0) {
      setLinkedElements([]);
      return;
    }

    try {
      const infos = await IssuesApi.getElementInfoByIds(iModelConnection, ids);
      setLinkedElements(infos);
    } catch {
      setLinkedElements([]); // 에러나도 UI는 정상 렌더
    }
  }, [currentIssue, iModelConnection]);

  /** call the client to get the issue attachments */
  const getIssueAttachments = useCallback(async () => {
    if (!currentIssue?.id) return;
    const id = currentIssue.id;

    // 이미 받아온 적 있으면 스킵
    if (issueAttachments[id]) return;

    const metaData = issueAttachmentMetaData[id];
    if (!metaData || metaData.length === 0) return;

    // 첨부 파일들 개별 다운로드
    for (const attachment of metaData) {
      const image = await IssuesClient.getAttachmentById(id, attachment.id!);
      if (image) {
        setIssueAttachments((prev) => ({
          ...prev,
          [id]: id in prev ? [...prev[id], image] : [image],
        }));
      }
    }
  }, [currentIssue?.id, issueAttachmentMetaData, issueAttachments]);

  /** call the client to get the issue comments */
  const getIssueComments = useCallback(async () => {
    if (!currentIssue?.id) return;
    const id = currentIssue.id;

    if (issueComments[id]) return;

    const res = await IssuesClient.getIssueComments(id);
    setIssueComments((prev) => ({ ...prev, [id]: res?.comments ?? [] }));
  }, [currentIssue?.id, issueComments]);

  /** call the client to get the issue Audit trail */
  const getIssueAuditTrail = useCallback(async () => {
    if (!currentIssue?.id) return;
    const id = currentIssue.id;

    if (issueAuditTrails[id]) return;

    const res = await IssuesClient.getIssueAuditTrail(id);
    setIssueAuditTrails((prev) => ({ ...prev, [id]: res?.auditTrailEntries ?? [] }));
  }, [currentIssue?.id, issueAuditTrails]);


  // 오버레이 헬퍼
  function applyOverlayToIssue(base: IssueGet, pending: IssueChange[]): IssueGet {
    // 같은 id의 pending 하나만 찾으면 됨
    const ov = [...pending].reverse().find(p => p.id && String(p.id) === String(base.id));
    if (!ov) return base;

    return {
      ...base,
      subject:     ov.subject   ?? base.subject,
      description: ov.body      ?? base.description,
      status:      ov.status    ?? base.status, // 업무상태
      state:       ov.state     ?? base.state,  // 워크플로
      modelPin: (ov.x!=null && ov.y!=null && ov.z!=null)
        ? { location: Point3d.create(ov.x!, ov.y!, ov.z!) }
        : base.modelPin,
      sourceEntity: ov.elementId
        ? { iModelElement: { elementId: ov.elementId, modelId:"", changeSetId:"", modelName:"" } as any }
        : base.sourceEntity,
      // assignee: 문자열이 “정의되어 있을 때만” 대체
      ...(ov.assignee !== undefined
        ? { assignee: { id: String(ov.assignee), displayName: String(ov.assignee) } }
        : {}),
    };
  }

  //목록 리로드 헬퍼
  const reloadIssues = React.useCallback(async () => {
    if (!auth?.apiBase) {
    setError("API base URL이 없습니다. (로그인이 필요하거나 auth 저장값이 비어 있음)");
    return;
    }
    if (!siteId) {
      setError("siteId가 설정되지 않았습니다.");
      return;
    }

    setLoading(true);
    setError(undefined);
    try {
      const type = issueFilter !== "all" ? issueFilter : undefined;
      const state = issueState !== "all" ? issueState : undefined;

      const issuesResp = await IssuesClient.getProjectIssues(siteId, type, state);

      const oldIssues: IssueGet[] = [];
      const promises: Array<Promise<IssueDetailsGet | undefined>> = [];

      issuesResp?.issues?.forEach((issue) => {
        if (!issue.id) return;
        const found = allIssues.current.find((v) => v.id === issue.id);
        if (found) oldIssues.push(found);
        else promises.push(IssuesClient.getIssueDetails(issue.id));
      });

      const details = await Promise.all(promises);
      const news = details.filter((r) => r?.issue).map((r) => r!.issue as IssueGet);

      const merged = oldIssues.concat(news);

      // ★ 보류 중 변경분을 화면 목록에 오버레이(낙관적 업데이트 유지)
      const overlayById = new Map(pendingIssues.filter(p=>p.id).map(p=>[String(p.id), p]));
      const mergedWithPending = merged.map(it => {
        const ov = overlayById.get(String(it.id));
        if (!ov) return it;
        return {
          ...it,
          subject: ov.subject ?? it.subject,
          description: ov.body ?? it.description,
          status: ov.status ?? it.status,
          state: ov.state ?? it.state,
          modelPin: (ov.x!=null&&ov.y!=null&&ov.z!=null) ? { location: Point3d.create(ov.x, ov.y, ov.z) } : it.modelPin,
          sourceEntity: ov.elementId ? { iModelElement: { elementId: ov.elementId, modelId:"", changeSetId:"", modelName:"" } as any } : it.sourceEntity,
        } as IssueGet;
      });

      // 현재 필터에 맞는 임시이슈만 남기기
      const filterState = issueState !== 'all' ? issueState : undefined;
      const filterType  = issueFilter !== 'all' ? issueFilter : undefined;
      const filterStatus = issueStatus !== 'all' ? issueStatus : undefined;
      const matchFilter = (iss: IssueGet) => {
        const stState = (iss.state || '').toLowerCase();
        const stStatus = (iss.status || '').toLowerCase();
        const ty = (iss.type || '').toString();

        const okState  = !filterState  || filterState.toLowerCase() === (stState || '').toLowerCase();
        const okType   = !filterType   || ty === filterType;
        const okStatus = !filterStatus || filterStatus.toLowerCase() === stStatus;

        // Deleted 처리: statusFilter가 없으면 삭제 숨김(기존 UX 유지)
        const notDeleted = stStatus !== 'deleted';
        const deletedVisible = filterStatus?.toLowerCase() === 'deleted';

        return okState && okType && okStatus && (deletedVisible ? true : notDeleted);
      };

      const withDrafts = [...draftIssuesRef.current.filter(matchFilter), ...mergedWithPending];

      setCurrentIssues(withDrafts);
      // ★ 현재 선택 이슈도 최신(withDrafts) + pending 오버레이로 동기화
      setCurrentIssue((prev) => {
        if (!prev?.id) return prev;
        // 새 목록에서 같은 이슈를 찾고, 없으면 이전 걸 유지(사용자가 상세를 보고 있을 수 있으니)
        const found = withDrafts.find(it => String(it.id) === String(prev.id)) ?? prev;
        return applyOverlayToIssue(found, pendingIssues);
      });
      if (allIssues.current.length === 0) allIssues.current = withDrafts;
    } catch (e: any) {
      console.error(e);
      setError(e?.message || "Failed to load issues");
      // 실패했어도 기존 목록은 남겨둔다
    } finally {
      setLoading(false);
    }
  }, [siteId, issueFilter, issueState, issueStatus]);

  // 선택집합 → elementId 배열
  function getSelectedElementIds(iModel?: IModelConnection): string[] {
    if (!iModel) return [];
    const set = iModel.selectionSet;
    if (!set) return [];
    return Array.from(set.elements);
  }

  // elementIds[] → KeySet JSON 문자열(bis.Element)
  function buildKeySetJSON(ids: string[]): string {
    return JSON.stringify({ instanceKeys: { "bis.Element": ids } });
  }

  // 1회성 포인트 선택 툴
  class OneShotPointTool extends PrimitiveTool {
    public static toolId = "Issues.OneShotPoint"; // ← 반드시 "네임스페이스.이름"
    public static resolver?: (pt: Point3d | undefined) => void;

    constructor() { super(); }

    public async onRestartTool(): Promise<void> {
      await IModelApp.toolAdmin.startDefaultTool();
    }

    public async onDataButtonDown(ev: BeButtonEvent): Promise<EventHandled> {
      try {
        OneShotPointTool.resolver?.(Point3d.fromJSON(ev.point));
      } finally {
        await IModelApp.toolAdmin.startDefaultTool();
      }
      return EventHandled.Yes;
    }

    public async onResetButtonUp(_ev: BeButtonEvent): Promise<EventHandled> {
      try {
        OneShotPointTool.resolver?.(undefined);
      } finally {
        await IModelApp.toolAdmin.startDefaultTool();
      }
      return EventHandled.Yes;
    }
  }

  /** 외부 헬퍼: 한 점을 픽 */
  async function pickPoint(): Promise<Point3d | undefined> {
    return new Promise<Point3d | undefined>(async (resolve) => {
      OneShotPointTool.resolver = resolve;

      if (!IModelApp.tools.find(OneShotPointTool.toolId)) {
        // ← 네임스페이스를 두 번째 인자로 넘겨서 등록
        IModelApp.tools.register(OneShotPointTool, "Issues");
      } else {

      //await IModelApp.tools.run(OneShotPointTool.toolId);
      }
    });
  }

  //Center / Point 버튼: 모달 잠시 숨기고 유저 액션 받기
  async function withModalHidden<T>(fn: () => Promise<T>): Promise<T> {
    setShowEdit(false);
    try { return await fn(); }
    finally { setShowEdit(true); }
  }

  const onCenterInteractive = async () => {
    if (!iModelConnection) return alert("iModel 연결이 없습니다.");
    const ids = await withModalHidden(() => IssuesApi.pickSelectionOnce(iModelConnection));
    if (!ids.length) return;
    try {
      const infos = await IssuesApi.getElementInfoByIds(iModelConnection, ids);
      const center = IssuesApi.centerOf(infos);
      if (center) setEditXYZ({ x: center.x, y: center.y, z: center.z });
      // 링크도 반영(중복제거)
      setEditLinks(prev => Array.from(new Set([...prev, ...ids])));
    } catch {
      alert("BBox/Origin 중심을 계산할 수 없습니다.");
    }
  };

  const onPointInteractive = async () => {
    if (!viewport) return;
    const pt = await withModalHidden(() => IssuesApi.promptForPointOnce(viewport));
    if (!pt) return;
    setEditXYZ({ x: pt.x, y: pt.y, z: pt.z });
  };

  //캡쳐 헬퍼
  async function captureViewportImageBlob(vp: any, W = 512, H = 288): Promise<Blob> {
    // 1) iTwin Viewport의 내부 이미지를 직접 읽기 (가장 안전)
    if (typeof vp.readImageBuffer === "function") {
      const ib = await vp.readImageBuffer({ size: { x: W, y: H } }); // 5.x에서 지원
      if (ib && ib.width && ib.height && ib.data) {
        // RGBA Uint8Array → Canvas → Blob
        const off = document.createElement("canvas");
        off.width = ib.width;
        off.height = ib.height;
        const ctx = off.getContext("2d")!;
        const imgData = new ImageData(new Uint8ClampedArray(ib.data.buffer), ib.width, ib.height);
        ctx.putImageData(imgData, 0, 0);
        // cover 비율 맞춤(썸네일 표준화: 16:9)
        if (ib.width !== W || ib.height !== H) {
          const dst = document.createElement("canvas");
          dst.width = W; dst.height = H;
          const dctx = dst.getContext("2d")!;
          // object-fit: cover
          const sRatio = ib.width / ib.height, dRatio = W / H;
          let sx = 0, sy = 0, sW = ib.width, sH = ib.height;
          if (sRatio > dRatio) { sW = Math.floor(ib.height * dRatio); sx = Math.floor((ib.width - sW) / 2); }
          else if (sRatio < dRatio) { sH = Math.floor(ib.width / dRatio); sy = Math.floor((ib.height - sH) / 2); }
          dctx.fillStyle = "#ffffff"; dctx.fillRect(0,0,W,H); // 불투명 배경
          dctx.drawImage(off, sx, sy, sW, sH, 0, 0, W, H);
          return await new Promise((res, rej) => dst.toBlob(b => b?res(b):rej("toBlob failed"), "image/jpeg", 0.9)!);
        }
        // 그대로 JPEG
        return await new Promise((res, rej) => off.toBlob(b => b?res(b):rej("toBlob failed"), "image/jpeg", 0.9)!);
      }
    }

    // 2) 폴백: 현재 WebGL 캔버스를 그려서 저장(덜 안전)
    const glCanvas = vp.canvas as HTMLCanvasElement;
    const off = document.createElement("canvas");
    off.width = W; off.height = H;
    const ctx = off.getContext("2d")!;
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, W, H);
    const sw = glCanvas.width, sh = glCanvas.height;
    const sRatio = sw / sh, dRatio = W / H;
    let sx = 0, sy = 0, sW = sw, sH = sh;
    if (sRatio > dRatio) { sW = Math.floor(sh * dRatio); sx = Math.floor((sw - sW) / 2); }
    else if (sRatio < dRatio) { sH = Math.floor(sw / dRatio); sy = Math.floor((sh - sH) / 2); }
    ctx.drawImage(glCanvas, sx, sy, sW, sH, 0, 0, W, H);
    return await new Promise((res, rej) => off.toBlob(b => b?res(b):rej("toBlob failed"), "image/jpeg", 0.9)!);
  }

  const onCaptureThumb = async () => {
    if (!siteId) return alert("siteId가 없습니다.");
    if (!currentIssue?.id) return alert("이슈 ID가 없습니다.");
    if (String(currentIssue.id).startsWith("tmp-")) {
      alert("먼저 Save로 이슈를 생성(정식 ID 발급)한 뒤 캡처하세요.");
      return;
    }
    const vp = IModelApp.viewManager.selectedView;
    if (!vp) return alert("활성 뷰가 없습니다.");

    // 0) 데코레이터 잠시 끄기(아이콘만 찍히는 문제 방지)
    IssuesApi.disableDecorations(issueDecorator);

    try {
      // 1) 한 프레임 보장 후 안전 캡처
      if (!vp.isDisposed) {
        vp.invalidateRenderPlan();
        vp.synchWithView();
        safeRequestRedraw(vp);
      }
      const blob = await captureViewportImageBlob(vp, 800, 600);

      // 6) 좌표가 없으면, 뷰 중심을 pin으로 큐잉(서버 저장 시 함께 반영)
      if (!currentIssue.modelPin?.location) {
        const fr = vp.view.computeFitRange();
        const center = fr.low.interpolate(0.5, fr.high);
        // 화면에 즉시 반영
        setCurrentIssue(ci => ci ? ({ ...ci, modelPin: { location: center } }) : ci);
        setCurrentIssues(list => list.map(it => it.id===currentIssue.id ? ({ ...it, modelPin: { location: center } }) : it));
        // 서버로도 저장되게 pending 큐에 넣음
        setPendingIssues(prev => {
          const dedup = prev.filter(p => !(p.id && String(p.id)===String(currentIssue.id)));
          return [...dedup, { id: currentIssue.id!, x: center.x, y: center.y, z: center.z }];
        });
      }

      // 7) 업로드
      const base = (auth?.apiBase || "").replace(/\/+$/, "");
      const url = `${base}/itwin/api/issues/uploadThumb.php`;
      const form = new FormData();
      form.append("siteId", siteId);
      form.append("issueId", currentIssue.id);
      form.append("file", blob, `${currentIssue.id}.jpg`);

      const res = await fetch(url, { method: "POST", body: form });
      const json = await res.json().catch(()=>({}));
      if (!res.ok || !json?.success) throw new Error(json?.message || res.statusText);

      // 리스트 썸네일 즉시 갱신
      if (currentIssue.displayName) {
        setPreviewImages(prev => ({ ...prev, [currentIssue.id!]: blob }));
      }
      alert("썸네일을 저장했습니다.");
    } catch (e:any) {
      console.error(e);
      alert(`썸네일 저장 실패: ${e?.message || e}`);
    } finally {
      // 6) 데코레이터 다시 켜고 마커 리드로우
      IssuesApi.enableDecorations(issueDecorator);
      setMarkerVersion(v => v + 1);

      if (vp && !vp.isDisposed) {
        vp.invalidateRenderPlan();
        safeRequestRedraw(vp);
      }
    }
  };

  useEffect(() => {
    void reloadIssues();
  }, [reloadIssues]);

  /** Make the client request when the tab for the issue is selected. */
  useEffect(() => {
    switch (activeTab) {
      case 0:
        getLinkedElements()
          .catch((error) => {
            // eslint-disable-next-line no-console
            console.error(error);
          });
        break;
      /** Attachments tab */
      case 1:
        getIssueAttachments()
          .catch((error) => {
            // eslint-disable-next-line no-console
            console.error(error);
          });
        break;
      /** Audit trail tab */
      case 2:
        getIssueComments()
          .catch((error) => {
            // eslint-disable-next-line no-console
            console.error(error);
          });
        getIssueAuditTrail()
          .catch((error) => {
            // eslint-disable-next-line no-console
            console.error(error);
          });
        break;
    }
  }, [activeTab, getIssueAttachments, getIssueAuditTrail, getIssueComments, getLinkedElements]);

  useEffect(() => {
    const ev: any = UiFramework.frontstages?.onWidgetStateChangedEvent;
    if (!ev?.addListener) return;

    const handler = (args: any) => {
      try {
        const wid = args?.widgetDef?.id ?? args?.widgetId;
        if (wid !== "IssuesWidget") return;

        const isOpen =
          args.widgetState === WidgetState.Open ||
          (WidgetState as any).Visible === args.widgetState;

        if (!isOpen) {
          IssuesApi.clearDecoratorPoints(issueDecorator);
          IssuesApi.disableDecorations(issueDecorator);
        } else {
          const vp = IModelApp?.viewManager?.selectedView;
          if (!vp) return;
          IssuesApi.enableDecorations(issueDecorator);
          setMarkerVersion((v) => v + 1);
          
          if (!vp.isDisposed) {
            vp.invalidateRenderPlan?.();
            safeRequestRedraw(vp);
          }
        }
      } catch { /* swallow */ }  
    };

    const remove = ev.addListener(handler);
    return () => {
      try { remove?.(); } catch {}
      try { ev.removeListener?.(handler); } catch {}
    };
  }, [issueDecorator]);

  const issueSummaryContent = () => {
    type RowT = { prop: string; val?: string };

    const columns = [
      { Header: "Properties", accessor: "prop" as const },
      { Header: "Value",      accessor: "val"  as const },
    ];

    const data: RowT[] = [
      { prop: "Id",             val: currentIssue?.id },
      { prop: "Subject",        val: currentIssue?.subject },
      { prop: "Status",         val: currentIssue?.status },
      { prop: "State",          val: currentIssue?.state },
      { prop: "Assignee",       val: currentIssue?.assignee?.displayName },
      { prop: "Due Date",       val: currentIssue?.dueDate },
      { prop: "Description",    val: currentIssue?.description },
      { prop: "Created Date",   val: currentIssue?.createdDateTime },
      { prop: "Last Modified",  val: currentIssue?.lastModifiedDateTime },
      { prop: "Created By",     val: currentIssue?.createdBy },
      { prop: "Assignees",      val: (currentIssue?.assignees?.map(a => a.displayName).join(", ")) ?? "" },
    ];

    return (
      <Table<RowT>
        className="table"
        columns={columns}
        data={data}
        emptyTableContent="No data"
        density="extra-condensed"
      />
    );
  };
  
  const issueLinkedElements = () => {
    if (!iModelConnection || !currentLinkedElements)
      return <></>;

    return (
      <div className={"issue-linked-container"}>
        <Text variant="subheading" className={"issue-linked-title"}>{`Linked Elements`}</Text>
        {currentLinkedElements.map((label) => {
          return (
            <div key={label.id} role="presentation" className={"issue-linked-element"} onClick={() => viewport?.zoomToElements(label.id)}>
              <div className={"icon icon-item"}></div>
              <div className={"issues-linked-element-label"}>
                <code style={{opacity:.8, marginRight:6}}>{label.id}</code>
                <span>{label.displayValue || (label as any).rawValue || "(no label)"}</span>
              </div>
            </div>);
        })}
      </div>
    );
  };

  const issueAttachmentsContent = React.useCallback(() => {
    if (!currentIssue?.id) return <Text>No attachments.</Text>;
    const id = currentIssue.id;

    const attachments = issueAttachments[id];
    const metaData = issueAttachmentMetaData[id];

    if (!metaData) return <Text>No attachments.</Text>;
    if (metaData.length === 0) return <Text>No attachments.</Text>;
    if (!attachments) {
      return (
        <div style={{ display: "flex", placeContent: "center" }}>
          <ProgressRadial indeterminate size="small" />
        </div>
      );
    }

    return attachments.map((attachment, index) => {
      const urlObj = URL.createObjectURL(attachment);
      // 각 썸네일 타일이 unmount 되면 revoke
      // (map 내부라 별도 useEffect가 어려워 onLoad 대체 또는 Anchor onClick로 다운로드만)
      return (
        <Tile
          key={`${id}_att_${index}`}
          style={{ marginTop: 5, marginBottom: 5 }}
          name={metaData[index]?.fileName}
          description={metaData[index]?.caption}
          thumbnail={
            <Anchor
              href={urlObj}
              className="thumbnail"
              download={metaData[index]?.fileName}
              style={{ backgroundImage: `url(${urlObj})` }}
              onMouseDown={() => {
                // 다운로드 트리거 후 다음 틱에 revoke 시도(사용자가 클릭했을 때)
                setTimeout(() => URL.revokeObjectURL(urlObj), 0);
              }}
            />
          }
        />
      );
    });
  }, [currentIssue?.id, issueAttachments, issueAttachmentMetaData]);

  const getColorByAction = (action: string | undefined) => {
    if (undefined === action)
      return "";

    switch (action) {
      case ("Created"): return "#4585a5";
      case ("Closed"): return "#f7706c";
      case ("Opened"): return "#b1c854";
      case ("File Attached"): return "#73c7c1";
      case ("File Removed"): return "#f7963e";
      case ("Modified"): return "#6ab9ec";
      case ("Assigned"): return "#ffc335";
      case ("Status"): return "#a3779f";
      case ("Form Raised"): return "#84a9cf";
      default: return "#c8c2b4";
    }
  };

  const getLabel = (auditTrail: AuditTrailEntryGet): JSX.Element => {
    let actionText: JSX.Element = (<></>);
    switch (auditTrail.action) {
      case "Created":
        actionText = (<span>by&nbsp;{auditTrail.changeBy}</span>);
        break;
      case "Modified":
        actionText = (<span>by&nbsp;{auditTrail.changeBy}</span>);
        break;
      case "Assigned":
        actionText = (<span>to {auditTrail.changes![0].newValue}</span>);
        break;
      case "Status":
        actionText = (<span>set to {auditTrail.changes![0].newValue}</span>);
        break;
      case "Opened":
        actionText = (<span>by&nbsp;{auditTrail.changeBy}</span>);
        break;
      case "File Attached":
        actionText = (<span>&quot;{auditTrail.changes![0].newValue?.substring(0, 25)}{auditTrail.changes![0].newValue!.length > 25 ? "..." : ""}&quot;</span>);
        break;
    }
    return (<><span className="issue-audit-label">&nbsp;{auditTrail.action}&nbsp;</span>{actionText}</>);
  };

  const issueAuditTrailContent = () => {
    if (!currentIssue?.id) return <Text>No content.</Text>;
    const id = currentIssue.id;

    const comments = issueComments[id];
    const auditTrail = issueAuditTrails[id];

    if (comments === undefined || auditTrail === undefined)
      return (<div style={{ display: "flex", placeContent: "center" }}><ProgressRadial indeterminate size="small" /></div>);
    if (comments.length === 0 && auditTrail.length === 0)
      return (<Text>No content.</Text>);

    /** separate audit trail by day */
    const combinedByDay: { [day: string]: JSX.Element[] } = {};
    auditTrail.sort((a, b) => new Date(a.changeDateTime!).getTime() - new Date(b.changeDateTime!).getTime());
    auditTrail.forEach((trail) => {
      const date = new Date(trail.changeDateTime!).toDateString();
      if (!combinedByDay[date]) {
        combinedByDay[date] = [];
      }
      const jsxAudit = (
        <div className="issue-audit-container">
          <div className="issue-audit-content">
            <div className="issue-audit-bubble" style={{ backgroundColor: getColorByAction(trail.action) }} />
            {getLabel(trail)}
          </div>
        </div>
      );
      combinedByDay[date].push(jsxAudit);
    });

    /** Add the comments into the byDay dict */
    comments.forEach((comment) => {
      const date = new Date(comment.createdDateTime!).toDateString();
      if (!combinedByDay[date]) {
        combinedByDay[date] = [];
      }
      const jsxComment = (
        <div className="comment-container">
          <div className="comment-header">
            <span>{comment.authorDisplayName}</span>
          </div>
          <div className="comment-content">
            <span className="comment-text">{comment.text}</span>
          </div>
        </div>
      );
      combinedByDay[date].push(jsxComment);
    });

    /** Get the dates in order */
    const combinedByDayOrdered = Object.keys(combinedByDay).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

    /** Loop through the dates and put them together in chunks */
    return combinedByDayOrdered.map((date) => (
      <div key={date.toString()} className="date-group">
        <div className="date">
          <span>{date}</span>
        </div>
        {combinedByDay[date]}
      </div>
    ));
  };

  const issueTypes: SelectOption<string>[] = [
    { value: "all", label: "All" },
    { value: "Clash", label: "Clash" },
    { value: "Closeout", label: "Closeout" },
    { value: "Data Quality", label: "Data Quality" },
    { value: "Field Data", label: "Field Data" },
  ];

  const issueStates: SelectOption<string>[] = [
    { value: "all", label: "All" },
    { value: "Closed", label: "Closed" },
    { value: "Open", label: "Open" },
    { value: "Draft", label: "Draft" },
    { value: "Deleted", label: "Deleted"},
  ];

  const issueStatuses: SelectOption<string>[] = [
    { value: "all", label: "All" },
    { value: "Unresolved", label: "Unresolved" },
    { value: "Resolved", label: "Resolved" },
    { value: "Verified", label: "Verified" },
    { value: "Deleted", label: "Deleted" },
  ];

  // ① Add: 임시 이슈 추가(좌표/엘리먼트ID는 필요시 채워넣기)
  const onAdd = () => setShowAdd(true);

  const confirmAdd = async () => {
    const subject = newSubject.trim();
    if (!subject) return;
    const tempId = `tmp-${Date.now()}`;
    let pin: Point3d | undefined;
    let links: string[] = [];

    if (iModelConnection) {
      const ids = getSelectedElementIds(iModelConnection);
      if (ids.length) {
        links = ids;
        try {
          const infos = await IssuesApi.getElementInfoByIds(iModelConnection, ids);
          const center = IssuesApi.centerOf(infos);
          if (center) pin = center;

          // ★ 선택이 없거나 center를 못 구했으면, 뷰 프러스텀 중심 사용
          if (!pin && viewport) {
            const fr = viewport.view.computeFitRange();         // ← computeViewRange 대신
            const center = fr.low.interpolate(0.5, fr.high);    // Range3d의 low/high 사용
            pin = center;
          }
        } catch {}
      }
    }

    const draft: IssueGet = {
      id: tempId,
      subject,
      status: "Unresolved", // ← 업무상태 기본값
      state: "Open",        // ← 워크플로 기본값
      type: "Issue",
      displayName: `${tempId} | ${subject}`,
      modelPin: pin ? { location: pin } : undefined,
      sourceEntity: links.length ? {
        iModelElement: { elementId: buildKeySetJSON(links), modelId: "", changeSetId: "", modelName: "" } as any,
      } : undefined,
    };
    setCurrentIssues((prev) => [draft, ...prev]);
    draftIssuesRef.current = [draft, ...draftIssuesRef.current]; // 임시데이터

    setPendingIssues((prev) => [
      ...prev,
      {
        subject,
        status: "Unresolved", // ← 서버에도 동일
        state: "Open",
        type: "Issue",
        elementId: links.length ? buildKeySetJSON(links) : null,
        x: pin?.x ?? null, y: pin?.y ?? null, z: pin?.z ?? null,
      },
    ]);
    setShowAdd(false);
    setNewSubject("");
    setMarkerVersion(v => v + 1);
  };

  // ② Modify: 현재 선택 이슈의 일부 필드 수정(mark as pending)
  const onModify = () => {
    const target = currentIssue;
    if (!target?.id) { alert("수정할 이슈를 먼저 선택하세요."); return; }

    setEditSubject(target.subject ?? "");
    setEditDescription(target.description ?? "");

    // State 초기값 (없으면 Open)
    setEditState(((target.state as any) ?? "Open") as any);

    // Status 초기값 (없으면 Unresolved로)
    const initStatus = ((): "Unresolved"|"Resolved"|"Verified" => {
      const s = String(target.status || "").toLowerCase();
      if (s === "resolved") return "Resolved";
      if (s === "verified") return "Verified";
      return "Unresolved";
    })();
    setEditStatus(initStatus);

    setEditAssignee(target.assignee?.displayName ?? target.assignee?.id ?? "");

    const rawKeySet = target.sourceEntity?.iModelElement?.elementId as string | undefined;
    setEditLinks(IssuesApi.parseElementIds(rawKeySet));

    const loc = target.modelPin?.location;
    setEditXYZ({ x: loc?.x, y: loc?.y, z: loc?.z });

    setShowEdit(true);
  };

  const confirmModify = () => {
    const t = currentIssue;
    if (!t?.id) return;

    const newPending: IssueChange = {
      id: t.id!,
      subject: editSubject,
      body: editDescription,
      status: editStatus,
      state: editState,
      elementId: editLinks.length ? buildKeySetJSON(editLinks) : null,
      x: editXYZ.x ?? null, y: editXYZ.y ?? null, z: editXYZ.z ?? null,
      ...(editAssignee.trim() ? { assignee: editAssignee.trim() } : {}), // ← 핵심: 빈값이면 필드 자체를 생략
    };

    setPendingIssues(prev => {
      // ★ 같은 이슈(id)의 기존 pending은 제거하고 새걸로 교체
      const deduped = prev.filter(p => !(p.id && String(p.id) === String(t.id)));
      const merged  = [...deduped, newPending];

      // ★ 화면 즉시 반영: 헬퍼로 동일 규칙 적용
      const overlaid = applyOverlayToIssue(t, merged);
      setCurrentIssue(overlaid);
      setCurrentIssues(list => list.map(it => it.id === t.id ? overlaid : it));

      return merged;
    });

    setShowEdit(false);
    setMarkerVersion(v => v + 1);
  };

  // ③ Delete: 현재 선택 이슈 삭제 마킹 (소프트 삭제 기준)
  const onDelete = () => {
    const target = currentIssue;
    if (!target?.id) { alert("삭제할 이슈를 먼저 선택하세요."); return; }
    if (!confirm("정말 삭제하시겠습니까? (Deleted 상태로 표시됩니다)")) return;

    // 화면 표시상 즉시 상태 변경
    setCurrentIssues((prev) => prev.map(it => it.id===target.id ? { ...it, status: "Deleted", state: "Draft" } : it));
    setCurrentIssue((prev) => prev ? { ...prev, status: "Deleted", state: "Draft" } : prev);

    // 변경분 큐(소프트 삭제 마킹)
    setPendingIssues((prev)=>[
      ...prev,
      { id: target.id!, _deleted: true }
    ]);
  };

  // ④ Save: 변경분 서버 반영
  const onSave = async () => {
    if (!auth?.apiBase || !auth?.userId || !siteId) { alert("로그인이 필요합니다."); return; }
    if (pendingIssues.length === 0) { alert("변경 사항이 없습니다."); return; }

    try {
      const res = await IssuesClient.saveProjectIssues(siteId, auth.userId, pendingIssues);
      if (!res?.success) throw new Error(res?.message || "save failed");

      // 큐 비우고, 목록 재로드
      setPendingIssues([]);
      await reloadIssues();
      draftIssuesRef.current = [];
      alert(`Saved: upserts=${res.upserts ?? 0}, deletes=${res.deletes ?? 0}`);
    } catch (e:any) {
      console.error(e);
      alert(`Save failed: ${e?.message || e}`);
    }
  };

  // 선택한 요소들로 링크 추가(중복 제거) + 중심 좌표 계산해 편집 좌표에 반영
  const onLinkFromSelection = async () => {
    if (!iModelConnection) return alert("iModel 연결이 없습니다.");
    const ids = getSelectedElementIds(iModelConnection);
    if (ids.length === 0) return alert("선택된 요소가 없습니다.");

    // 링크 추가
    setEditLinks((prev) => Array.from(new Set([...prev, ...ids])));

    // 중심 좌표 보정
    try {
      const infos = await IssuesApi.getElementInfoByIds(iModelConnection, ids);
      const center = IssuesApi.centerOf(infos);
      if (center) setEditXYZ({ x: center.x, y: center.y, z: center.z });
    } catch {}
  };

  // 특정 링크 하나 제거
  const onUnlinkOne = (id: string) => {
    setEditLinks((prev) => prev.filter((v) => v !== id));
  };

  // 링크 전체 제거
  const onUnlinkAll = () => setEditLinks([]);
  
  // ------- F1) 리스트 아이템(썸네일 URL 생성/정리) 컴포넌트 -------
  const IssueListItem: React.FC<{
    issue: IssueGet;
    blob?: Blob;
    onZoom: () => void;
    color: string;
    onOpenDetail: () => void;
  }> = ({ issue, blob, onZoom, color, onOpenDetail }) => {
    const [url, setUrl] = React.useState<string>();

    useEffect(() => {
      if (!blob) {
        setUrl(undefined);
        return;
      }
      // 플레이스홀더(1x1 투명 PNG) 피하기
      if (blob.type === "image/png" && blob.size <= 100) {
        setUrl(undefined);
        return;
      }
      const u = URL.createObjectURL(blob);
      setUrl(u);
      return () => URL.revokeObjectURL(u);
    }, [blob]);

    const createdDate =
      (issue.createdDateTime ?? issue.lastModifiedDateTime ?? issue.dueDate)
        ? new Date(
            (issue.createdDateTime ?? issue.lastModifiedDateTime ?? (issue.dueDate as string))
          ).toLocaleDateString()
        : undefined;

    return (
      <div className="issue">
        <div className="issue-preview">
          <div
            className="thumbnail"
            role="presentation"
            style={url ? { backgroundImage: `url(${url})` } : {}}
            onClick={onZoom}
            title="Locate & Zoom"
          >
            <span className="open icon icon-zoom" />
          </div>
          <div
            className="issue-status"
            style={{ borderTop: `14px solid ${color}`, borderLeft: `14px solid transparent` }}
          />
        </div>
        <div className="issue-info" role="presentation" onClick={onOpenDetail}>
          <Text variant="leading" className={"issue-title"}>
            {`${issue.number ?? `i-${String(issue.id).padStart(5, "0")}`} | ${issue.subject ?? ""}`}
          </Text>
          <div className="issue-subtitle">
            <span className={"assignee-display-name"}>{issue.assignee?.displayName}</span>
            <div className={"created-date"}><span>{createdDate}</span></div>
          </div>
        </div>
      </div>
    );
  };


  return (
    <>
      <div className={"issues-widget"} >
        {isAdmin ? (
          <div style={{display:"flex", gap:8, alignItems:"center", padding:"8px 12px"}}>
            <Button size="small" onClick={onAdd}>Add</Button>
            <Button size="small" onClick={onModify}>Modify</Button>
            <Button size="small" onClick={onDelete}>Delete</Button>
            <Button size="small" styleType="high-visibility" onClick={onSave}>Save</Button>
          </div>
        ) : null}
        {/** Only display header when issue isn't selected */}
        {!currentIssue &&
          <div className="issue-list-header">
            <Text variant="subheading" style={{ margin: "0", padding: "8px 5px" }}>{`Issues (${currentIssues.length})`}</Text>
            <div className="issue-list-filters">
              <div className="filter">
                <LabeledSelect label="State:" size="small" displayStyle="inline" options={issueStates} value={issueState} onChange={(value: string) => setIssueState(value)}></LabeledSelect>
              </div>
              <div className="filter">
                <LabeledSelect label="Status:" size="small" displayStyle="inline" options={issueStatuses} value={issueStatus} onChange={(value: string)=>setIssueStatus(value)}></LabeledSelect>
              </div>
              <div className="filter">
                <LabeledSelect label="Type:" size="small" displayStyle="inline" options={issueTypes} value={issueFilter} onChange={(value: string) => setIssueType(value)}></LabeledSelect>
              </div>
            </div>
          </div>}

        {/** When the issues haven't loaded yet, display spinner */}
        {loading &&
          <div className="issues-widget-loading">
            <ProgressRadial indeterminate={true} size="small"></ProgressRadial>
          </div>
        }
        {!loading && error && (
          <Alert type="negative" style={{ margin: 8 }}>
            {error}
          </Alert>
        )}

        {/** When there are no issues retrieved from filter. */}
        {!loading && !error && currentIssues.length === 0 && (
          <span style={{ color: "#fff", padding: 4 }}>No Content.</span>
        )}

        {/** When the issues are loaded, display them in a list */}
        {!currentIssue && currentIssues.length > 0 &&
          <div>
            {currentIssues.map((issue: IssueGet) => {
              const color = issueStatusColor(issue);
              const blob = issue.id ? previewImages[issue.id] : undefined;

              return (
                <IssueListItem
                  key={issue.id}
                  issue={issue}
                  blob={blob}
                  color={color}
                  onZoom={() => applyView(issue)}
                  onOpenDetail={() => { setCurrentIssue(issue); setActiveTab(0); }}
                />
              );
            })}
          </div>
        }

        {/** When an issue is selected from the initial list, show the tab interface */}
        {currentIssue &&
          <div className={"issue-details"}>
            <Text variant="leading" className={"header"}>
              <IconButton 
                label="Back" 
                styleType="borderless" 
                size="small" 
                className="back-button" 
                onClick={() => {   
                  const hasPending = pendingIssues.length > 0 || draftIssuesRef.current.length > 0;
                  if (!hasPending) {
                    setCurrentIssue(undefined);
                    setLinkedElements(undefined);
                    return;
                  }
                  // 확인 모달 열고, 실제 액션은 콜백에 담아둠
                  setLeaveAction(() => () => {
                    setCurrentIssue(undefined);
                    setLinkedElements(undefined);
                  });
                  setShowLeaveConfirm(true);
                }} ><span className="icon icon-chevron-left"></span>
              </IconButton>
              {`${currentIssue.number} | ${currentIssue.subject}`}
            </Text>

            <Tabs
              orientation="horizontal"
              activeIndex={activeTab}
              onTabSelected={setActiveTab}
              labels={[
                <Tab key="sum" label="Summary" />,
                <Tab key="att" label="Attachments" />,
                <Tab key="aud" label="Audit Trail" />,
              ]}
            />

            {/* 패널은 직접 조건부 렌더링으로 딱 하나만 표시 */}
            {activeTab === 0 && (
              <div className="issue-summary">
                {issueSummaryContent()}
                {issueLinkedElements()}
              </div>
            )}
            {activeTab === 1 && (
              <div className="issue-attachments">
                {issueAttachmentsContent()}
              </div>
            )}
            {activeTab === 2 && (
              <div className="issue-audit-trail">
                {issueAuditTrailContent()}
              </div>
            )}
          </div>
        }
      </div>
      
      <Modal
        isOpen={showAdd}
        title="Add Issue"
        onClose={() => setShowAdd(false)}
        closeOnEsc
        closeOnExternalClick
      >
        <div style={{ display: "grid", gap: 8 }}>
          <InputGroup label="Subject">
            <input value={newSubject} onChange={(e) => setNewSubject(e.target.value)} />
          </InputGroup>
        </div>

        <ModalButtonBar>
          <Button onClick={() => setShowAdd(false)}>Cancel</Button>
          <Button styleType="high-visibility" onClick={confirmAdd}>Add</Button>
        </ModalButtonBar>
      </Modal>
      <Modal
        isOpen={showEdit}
        title="Modify Issue"
        onClose={() => setShowEdit(false)}
        closeOnEsc
        closeOnExternalClick
      >
        <div style={{ display: "grid", gap: 8 }}>
          <InputGroup label="Subject">
            <input value={editSubject} onChange={(e) => setEditSubject(e.target.value)} />
          </InputGroup>

          <InputGroup label="Status">
            <select value={editStatus} onChange={(e)=>setEditStatus(e.target.value as any)}>
              <option>Unresolved</option>
              <option>Resolved</option>
              <option>Verified</option>
            </select>
          </InputGroup>

          <InputGroup label="Workflow State">
            <select value={editState} onChange={(e)=>setEditState(e.target.value as any)}>
              <option>Open</option>
              <option>Closed</option>
              <option>Draft</option>
            </select>
          </InputGroup>

          <InputGroup label="Assignee">
            <input value={editAssignee} onChange={(e)=>setEditAssignee(e.target.value)} />
          </InputGroup>

          <InputGroup label="Description">
            <textarea value={editDescription} onChange={(e)=>setEditDescription(e.target.value)} rows={4}/>
          </InputGroup>

          <InputGroup label="Linked Elements">
            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Button size="small" onClick={onLinkFromSelection}>Link from Selection</Button>
                <Button size="small" onClick={onCenterInteractive}>Center</Button>
                <Button size="small" onClick={onPointInteractive}>Point</Button>
                <Button size="small" onClick={onUnlinkAll}>Clear</Button>

                <IconButton size="small" title="Capture & Save Thumbnail" onClick={onCaptureThumb}>
                  <span className="icon icon-camera" />
                </IconButton>
              </div>

              {editLinks.length === 0 ? (
                <Text>&nbsp;No linked elements.</Text>
              ) : (
                <div style={{ display: "grid", gap: 4, maxHeight: 140, overflow: "auto", padding: 6, border: "1px solid #4c4c4c", borderRadius: 6 }}>
                  {editLinks.map((id) => (
                    <div key={id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <code style={{ fontSize: 12 }}>{id}</code>
                      <Button size="small" onClick={() => onUnlinkOne(id)}>Unlink</Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </InputGroup>

          <div style={{display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8}}>
            <InputGroup label="X"><input type="number" value={editXYZ.x ?? ''} onChange={(e)=>setEditXYZ(s=>({...s, x: e.target.value ? Number(e.target.value) : undefined}))}/></InputGroup>
            <InputGroup label="Y"><input type="number" value={editXYZ.y ?? ''} onChange={(e)=>setEditXYZ(s=>({...s, y: e.target.value ? Number(e.target.value) : undefined}))}/></InputGroup>
            <InputGroup label="Z"><input type="number" value={editXYZ.z ?? ''} onChange={(e)=>setEditXYZ(s=>({...s, z: e.target.value ? Number(e.target.value) : undefined}))}/></InputGroup>
          </div>
        </div>

        <ModalButtonBar>
          <Button onClick={() => setShowEdit(false)}>Cancel</Button>
          <Button styleType="high-visibility" onClick={confirmModify}>Apply</Button>
        </ModalButtonBar>
      </Modal>

      <Modal
        isOpen={showLeaveConfirm}
        title="수정사항을 저장하시겠습니까?"
        onClose={() => setShowLeaveConfirm(false)}
        closeOnEsc closeOnExternalClick
      >
        <div style={{padding:4}}>저장하지 않은 변경 사항이 있습니다.</div>
        <ModalButtonBar>
          <Button onClick={() => { // Cancel
            setShowLeaveConfirm(false);
          }}>Cancel</Button>
          <Button onClick={() => { // No: 버리고 나가기
            draftIssuesRef.current = [];
            setPendingIssues([]);
            setShowLeaveConfirm(false);
            leaveAction?.();
          }}>No</Button>
          <Button styleType="high-visibility" onClick={async () => { // Yes: 저장 후 나가기
            setShowLeaveConfirm(false);
            await onSave();
            leaveAction?.();
          }}>Yes</Button>
        </ModalButtonBar>
      </Modal>

    </>
  );
};

export class IssuesWidgetProvider implements UiItemsProvider {
  public readonly id: string = "IssuesWidgetProvider";

  public provideWidgets(_stageId: string, _stageUsage: string, location: StagePanelLocation, _section?: StagePanelSection): ReadonlyArray<Widget> {
    const widgets: Widget[] = [];
    if (location === StagePanelLocation.Right && _section === StagePanelSection.Start) {
      widgets.push(
        {
          id: "IssuesWidget",
          label: "Issue Selector",
          defaultState: WidgetState.Hidden,
          content: <IssuesWidget />,
        }
      );
    }
    return widgets;
  }
}