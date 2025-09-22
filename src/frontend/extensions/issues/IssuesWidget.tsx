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
import { IModelApp, PrimitiveTool, BeButtonEvent, EventHandled } from "@itwin/core-frontend";
import { MarkerPinDecorator } from "../issues/marker-pin/MarkerPinDecorator";
import IssuesApi, { LabelWithId } from "./IssuesApi";
import IssuesClient, { AttachmentMetadataGet, AuditTrailEntryGet, CommentGetPreferReturnMinimal, IssueDetailsGet, IssueGet, IssueChange } from "./IssuesClient";
import { useAuth } from "../../services/AuthContext";
import "./Issues.scss";

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
  /** All issues */
  const allIssues = useRef<IssueGet[]>([]);
  /** The issues currently being displayed */
  const [currentIssues, setCurrentIssues] = useState<IssueGet[]>([]);
  const [previewImages, setPreviewImages] = useState<{ [displayName: string]: Blob }>({});
  /** The pictures / attachments that are associated with the issue */
  const [issueAttachmentMetaData, setIssueAttachmentMetaData] = useState<{ [displayName: string]: AttachmentMetadataGet[] }>({});
  /** The blobs for each issue's attachments */
  const [issueAttachments, setIssueAttachments] = useState<{ [displayName: string]: Blob[] }>({});
  /** The comments associated with each issue */
  const [issueComments, setIssueComments] = useState<{ [displayName: string]: CommentGetPreferReturnMinimal[] }>({});
  /** The audit trail associated with each issue */
  const [issueAuditTrails, setIssueAuditTrails] = useState<{ [displayName: string]: AuditTrailEntryGet[] }>({});
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
  const [editStatus, setEditStatus] = useState<"Open"|"Closed"|"Draft"|"Deleted">("Open");
  const [editDescription, setEditDescription] = useState("");
  const [editElementId, setEditElementId] = useState(""); // 원본 elementId 문자열
  const [editXYZ, setEditXYZ] = useState<{x?:number,y?:number,z?:number}>({});
  //마커
  const [markerVersion, setMarkerVersion] = useState(0);
  const [editLinks, setEditLinks] = useState<string[]>([]); // 링크된 elementId 배열


  /** Initialize Decorator */
  useEffect(() => {
    IssuesApi.enableDecorations(issueDecorator);
    return () => {
      IssuesApi.disableDecorations(issueDecorator);
    };
  }, [issueDecorator]);

  /** Set the preview Images on issue load */
  useEffect(() => {
    currentIssues.map(async (issue) => {
      if (issue.id) {
        const metaData = await IssuesClient.getIssueAttachments(issue.id);
        const previewAttachmentId = metaData?.attachments ? metaData.attachments[0]?.id : undefined;
        if (previewAttachmentId !== undefined && !thumbnails.has(previewAttachmentId)) {
          const binaryImage = await IssuesClient.getAttachmentById(issue.id, previewAttachmentId);
          if (binaryImage)
            setPreviewImages((prevState) => ({ ...prevState, [issue.displayName as string]: binaryImage }));
        }

        /** Set the rest of the attachments in the attachmentMetaData */
        if (metaData?.attachments) {
          setIssueAttachmentMetaData((prevState) => ({ ...prevState, [issue.displayName as string]: metaData.attachments!.length > 1 ? metaData.attachments!.slice(1) : [] }));
        }
      }
    });
  }, [currentIssues]);

  const applyView = useCallback(async (issue: IssueGet) => {
    /** apply the camera position if present */
    if (viewport?.view.is3d()) {
      const view3d = viewport.view;
      const cameraView = issue.modelView?.cameraView;
      if (cameraView) {
        const eyePoint = Point3d.fromJSON(cameraView.viewPoint);
        const upVector = Vector3d.fromJSON(cameraView.up);
        const directionVector = Point3d.fromJSON(cameraView.direction);
        const fov = Angle.degreesToRadians(cameraView.fieldOfView!);
        const targetPoint = eyePoint.plus(directionVector);
        view3d.lookAt({ eyePoint, targetPoint, upVector, lensAngle: Angle.createRadians(fov) });
        viewport.synchWithView();
      }
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

      // 1) 좌표가 없다면 더이상 진행하지 않음(마커 못 그림)
      if (!issue.modelPin?.location) return;

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
    switch (issue.status) {
      case "Unresolved": /* Orange */
        return "#F18812";
      case "Verified":  /* Blue */
        return "#0088FF";
      case "Resolved": /* Green */
        return "#56A91C";
      default: /* Rejected: Red */
        return "#D30A0A";
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

  const getLinkedElements = useCallback(async () => {
    /** Don't refetch if we have already received the linked elements */
    if (!iModelConnection || currentLinkedElements || !currentIssue)
      return;

    if (!currentIssue.sourceEntity?.iModelElement?.elementId) {
      setLinkedElements([]);
      return;
    }

    const elementKeySet = await IssuesApi.getElementKeySet(currentIssue.sourceEntity?.iModelElement?.elementId);
    const elementInfo = await IssuesApi.getElementInfo(iModelConnection, elementKeySet);
    setLinkedElements(elementInfo);
  }, [currentIssue, currentLinkedElements, iModelConnection]);

  /** call the client to get the issue attachments */
  const getIssueAttachments = useCallback(async () => {
    /** If the attachments have already been retrieved don't refetch*/
    if (!currentIssue || (currentIssue.displayName && issueAttachments[currentIssue.displayName]))
      return;

    /** Grab the attachments */
    const metaData = issueAttachmentMetaData[currentIssue.displayName!];
    metaData?.forEach(async (attachment) => {
      const image = await IssuesClient.getAttachmentById(currentIssue.id!, attachment.id!);
      if (image)
        setIssueAttachments((prevState) => ({ ...prevState, [currentIssue.displayName as string]: currentIssue.displayName! in prevState ? [...prevState[currentIssue.displayName!], image] : [image] }));
    });
  }, [currentIssue, issueAttachmentMetaData, issueAttachments]);

  /** call the client to get the issue comments */
  const getIssueComments = useCallback(async () => {
    /** If the comments have already been retrieved don't refetch*/
    if (!currentIssue || (currentIssue.displayName && issueComments[currentIssue.displayName]))
      return;

    /** Grab the comments */
    const commentsResponse = await IssuesClient.getIssueComments(currentIssue.id!);
    const comments = commentsResponse?.comments ? commentsResponse?.comments : [];

    /** Set the comments */
    setIssueComments((prevState) => ({ ...prevState, [currentIssue.displayName as string]: comments }));
  }, [currentIssue, issueComments]);

  /** call the client to get the issue Audit trail */
  const getIssueAuditTrail = useCallback(async () => {
    /** If the comments have already been retrieved don't refetch*/
    if (!currentIssue || (currentIssue.displayName && issueAuditTrails[currentIssue.displayName]))
      return;

    /** Grab the comments */
    const auditResponse = await IssuesClient.getIssueAuditTrail(currentIssue.id!);
    const auditTrail = auditResponse?.auditTrailEntries ? auditResponse.auditTrailEntries : [];

    /** Set the audit trail for the currentIssue */
    setIssueAuditTrails((prevState) => ({ ...prevState, [currentIssue.displayName as string]: auditTrail }));
  }, [currentIssue, issueAuditTrails]);

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

      // 현재 필터에 맞는 임시이슈만 남기기
      const filterState = issueState !== 'all' ? issueState : undefined;
      const filterType  = issueFilter !== 'all' ? issueFilter : undefined;
      const matchFilter = (iss: IssueGet) => {
        const st = (iss.state || iss.status || '').toLowerCase();
        const ty = (iss.type  || '').toString();
        const notDeleted = (iss.status || '').toLowerCase() !== 'deleted';
        const okState = !filterState || filterState.toLowerCase() === (st || 'open').toLowerCase();
        const okType  = !filterType  || ty === filterType;
        return okState && okType && (!filterState || filterState === 'Deleted' ? true : notDeleted);
      };
      const withDrafts = [...draftIssuesRef.current.filter(matchFilter), ...merged];

      setCurrentIssues(withDrafts);
      if (allIssues.current.length === 0) allIssues.current = withDrafts;
    } catch (e: any) {
      console.error(e);
      setError(e?.message || "Failed to load issues");
      // 실패했어도 기존 목록은 남겨둔다
    } finally {
      setLoading(false);
    }
  }, [siteId, issueFilter, issueState]);

  // KeySet JSON 또는 공백구분 문자열 → elementId 배열
  function parseElementIds(raw?: string): string[] {
    if (!raw) return [];
    try {
      const kj = JSON.parse(raw);
      const arr = kj?.instanceKeys?.["bis.Element"];
      if (Array.isArray(arr)) return arr.map(String);
    } catch {
      // 공백 구분 "0x123 0x456" 형태 지원
      return raw.split(/\s+/).filter(Boolean);
    }
    return [];
  }

  // 선택집합 → elementId 배열
  function getSelectedElementIds(iModel?: ReturnType<typeof useActiveIModelConnection>): string[] {
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
    public static toolId = "OneShotPointTool";
    /** 외부에서 주입하는 resolver */
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

  /** 외부 헬퍼: 한 점을 픽 (문자열 run) */
  async function pickPoint(): Promise<Point3d | undefined> {
    return new Promise<Point3d | undefined>(async (resolve) => {
      // resolver 주입
      OneShotPointTool.resolver = resolve;

      // 아직 등록 안되어 있으면 등록
      if (!IModelApp.tools.find(OneShotPointTool.toolId)) {
        IModelApp.tools.register(OneShotPointTool);
      }

      // ✅ 이 버전은 문자열만 받음
      await IModelApp.tools.run(OneShotPointTool.toolId);
    });
  }

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
    const remove = UiFramework.frontstages.onWidgetStateChangedEvent.addListener(
      (args: WidgetStateChangedArgs) => {
        const wid = args.widgetDef?.id ?? args.widgetId;
        if (wid !== "IssuesWidget") return;

        const isOpen =
          args.widgetState === WidgetState.Open ||
          (WidgetState as any).Visible === args.widgetState; // 일부 버전 호환

        if (!isOpen) {
          // 패널이 닫히면 마커/데코레이터 숨김
          IssuesApi.clearDecoratorPoints(issueDecorator);
          IssuesApi.disableDecorations(issueDecorator);
        } else {
          // 다시 열리면 데코레이터 활성화 (마커는 currentIssues effect가 다시 그림)
          IssuesApi.enableDecorations(issueDecorator);
          setMarkerVersion(v => v + 1); //마커 다시그리기
        }
      }
    );
    return () => remove();
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
              <div className={"issues-linked-element-label"}>{label.displayValue}</div>
            </div>);
        })}
      </div>
    );
  };

  const issueAttachmentsContent = React.useCallback(() => {
    /** grab the comment for the current issue */
    const attachments = issueAttachments[currentIssue!.displayName!];
    const metaData = issueAttachmentMetaData[currentIssue!.displayName!];

    if (metaData.length === 0)
      return (<Text>No attachments.</Text>);
    else if (attachments === undefined)
      return (<div style={{ display: "flex", placeContent: "center" }}><ProgressRadial indeterminate={true} size="small"></ProgressRadial></div>);

    /** Loop through the dates and put them together in chunks */
    return attachments.map((attachment, index) => {
      const urlObj = URL.createObjectURL(attachment);
      return (
        <Tile
          key={`${currentIssue?.displayName}_Comments_${index}`}
          style={{ marginTop: "5px", marginBottom: "5px" }}
          name={metaData[index].fileName}
          description={metaData[index].caption}
          thumbnail={<Anchor href={urlObj} className="thumbnail" download={metaData[index].fileName} style={{ backgroundImage: `url(${urlObj})` }} />}
        />
      );
    });
  }, [issueAttachments, issueAttachmentMetaData, currentIssue]);

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
    /** grab the comment for the current issue */
    const comments = issueComments[currentIssue!.displayName!];

    /** grab the audit trail for the current issue */
    const auditTrail = issueAuditTrails[currentIssue!.displayName!];

    if (comments === undefined || auditTrail === undefined)
      return (<div style={{ display: "flex", placeContent: "center" }}><ProgressRadial indeterminate={true} size="small"></ProgressRadial></div>);
    else if (comments.length === 0 && auditTrail.length === 0)
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

  const getTabContent = () => {
    switch (activeTab) {
      case 0:
        return (<div className={"issue-summary"}>
          {issueSummaryContent()}
          {issueLinkedElements()}
        </div>);
      case 1:
        return (
          <div className={"issue-attachments"}>
            {issueAttachmentsContent()}
          </div>);
      case 2:
        return (
          <div className={"issue-audit-trail"}>
            {issueAuditTrailContent()}
          </div>);
      default:
        return (<></>);
    }
  };

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
        } catch {}
      }
    }

    const draft: IssueGet = {
      id: tempId,
      subject,
      status: "Open",
      state: "Open",
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
        status: "Open",
        type: "Issue",
        elementId: links.length ? buildKeySetJSON(links) : null,
        x: pin?.x ?? null, y: pin?.y ?? null, z: pin?.z ?? null,
      },
    ]);
    setShowAdd(false);
    setNewSubject("");
  };

  // ② Modify: 현재 선택 이슈의 일부 필드 수정(mark as pending)
  const onModify = () => {
    const target = currentIssue;
    if (!target?.id) { alert("수정할 이슈를 먼저 선택하세요."); return; }
    setEditSubject(target.subject ?? "");
    setEditStatus(((target.status as any) ?? "Open") as any);
    setEditDescription(target.description ?? "");

    // 원본 elementId 복원 시도 (properties에 없으면 비워둠)
  const rawKeySet = target.sourceEntity?.iModelElement?.elementId as string | undefined;
  setEditLinks(parseElementIds(rawKeySet));

  // 좌표
  const loc = target.modelPin?.location;
  setEditXYZ({ x: loc?.x, y: loc?.y, z: loc?.z });

  setShowEdit(true);
  };

  const confirmModify = () => {
    const t = currentIssue;
    if (!t?.id) return;

    // 화면 즉시 반영
    const next: IssueGet = {
      ...t,
      subject: editSubject,
      description: editDescription,
      status: editStatus,
      state: editStatus,
      modelPin: {
        location: (editXYZ.x!=null && editXYZ.y!=null && editXYZ.z!=null)
          ? Point3d.create(editXYZ.x, editXYZ.y, editXYZ.z)
          : t.modelPin?.location,
      },
      sourceEntity: editLinks.length ? {
        iModelElement: {
          // KeySet JSON을 elementId에 담아 둠 (getElementKeySet/zoom 에서 사용)
          elementId: buildKeySetJSON(editLinks),
          modelId: "", changeSetId: "", modelName: "",
        } as any,
      } : undefined,
    };
    setCurrentIssue(next);
    setCurrentIssues(prev => prev.map(it => it.id===t.id ? next : it));

    // 서버로 보낼 변경분 큐 (DB 컬럼명 기준)
    setPendingIssues(prev => ([
      ...prev,
      {
        id: t.id!,
        subject: editSubject,
        body: editDescription,
        status: editStatus,
        elementId: editLinks.length ? buildKeySetJSON(editLinks) : null,
        x: editXYZ.x ?? null, y: editXYZ.y ?? null, z: editXYZ.z ?? null,
      }
    ]));

    setShowEdit(false);
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

  // 링크의 bbox 중심으로 좌표 맞추기
  const onCenterFromLinks = async () => {
    if (!iModelConnection) return;
    const ids = editLinks;
    if (ids.length === 0) return alert("링크가 없습니다.");
    try {
      const infos = await IssuesApi.getElementInfoByIds(iModelConnection, ids);
      const center = IssuesApi.centerOf(infos);
      if (center) setEditXYZ({ x: center.x, y: center.y, z: center.z });
      else alert("BBox 중심을 계산할 수 없습니다.");
    } catch (e) {
      alert("중심 계산 실패");
    }
  };

  // 포인트 찍어서 좌표 설정
  const onPickPoint = async () => {
    const pt = await pickPoint();
    if (!pt) return; // 취소
    setEditXYZ({ x: pt.x, y: pt.y, z: pt.z });
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
              const createdDate =
                (issue.createdDateTime ?? issue.lastModifiedDateTime ?? issue.dueDate)
                  ? new Date(issue.createdDateTime ?? issue.lastModifiedDateTime ?? issue.dueDate!).toLocaleDateString()
                  : undefined;

              const binaryUrl = issue.displayName && previewImages[issue.displayName]
                ? URL.createObjectURL(previewImages[issue.displayName])
                : undefined;
              const imageStyle = binaryUrl ? { backgroundImage: `url(${binaryUrl})` } : {};

              return (
                <div key={issue.id} className="issue">
                  <div className="issue-preview">
                    {issue.modelView &&
                      <div className="thumbnail" role="presentation" style={imageStyle} onClick={async () => applyView(issue)}>
                        <span className="open icon icon-zoom" title={"Locate & Zoom"} />
                      </div>
                    }
                    <div className="issue-status" style={{ borderTop: `14px solid ${issueStatusColor(issue)}`, borderLeft: `14px solid transparent` }} />
                  </div>
                  <div className="issue-info" role="presentation" onClick={() => { setCurrentIssue(issue); setActiveTab(0); }}>
                    <Text variant="leading" className={"issue-title"}>
                      {`${issue.number ?? issue.id ?? ""} | ${issue.subject ?? ""}`}
                    </Text>
                    <div className="issue-subtitle">
                      <span className={"assignee-display-name"}>{issue.assignee?.displayName}</span>
                      <div className={"created-date"}>
                        <span>{createdDate}</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        }

        {/** When an issue is selected from the initial list, show the tab interface */}
        {currentIssue &&
          <div className={"issue-details"}>
            <Text variant="leading" className={"header"}>
              <IconButton label="Back" styleType="borderless" size="small" className="back-button" onClick={() => { setCurrentIssue(undefined); setLinkedElements(undefined); }}><span className="icon icon-chevron-left"></span></IconButton>
              {`${currentIssue.number} | ${currentIssue.subject}`}
            </Text>

            <Tabs
              orientation="horizontal"
              onTabSelected={(index) => setActiveTab(index)}
              labels={[
                <Tab key={0} label="Summary" />,
                <Tab key={1} label="Attachments" />,
                <Tab key={2} label="Audit Trail" />,
              ]}
            >
              {getTabContent()}
            </Tabs>
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
              <option>Open</option>
              <option>Closed</option>
              <option>Draft</option>
              <option>Deleted</option>
            </select>
          </InputGroup>

          <InputGroup label="Description">
            <textarea value={editDescription} onChange={(e)=>setEditDescription(e.target.value)} rows={4}/>
          </InputGroup>

          <InputGroup label="Linked Elements">
            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Button size="small" onClick={onLinkFromSelection}>Link from Selection</Button>
                <Button size="small" onClick={onCenterFromLinks}>Center</Button>
                <Button size="small" onClick={onPickPoint}>Point</Button>
                <Button size="small" onClick={onUnlinkAll}>Clear</Button>
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