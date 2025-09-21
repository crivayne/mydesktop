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
  WidgetState
} from "@itwin/appui-react";
import { Angle, Point3d, Vector3d } from "@itwin/core-geometry";
import { Alert, Anchor, IconButton, LabeledSelect, ProgressRadial, SelectOption, Tab, Table, Tabs, Text, Tile,Button } from "@itwin/itwinui-react";
import { MarkerPinDecorator } from "../issues/marker-pin/MarkerPinDecorator";
import IssuesApi, { LabelWithId } from "./IssuesApi";
import IssuesClient, { AttachmentMetadataGet, AuditTrailEntryGet, CommentGetPreferReturnMinimal, IssueDetailsGet, IssueGet, IssueChange } from "./IssuesClient";
import { useAuth } from "../../services/AuthContext";
import "./Issues.scss";

const thumbnails: Map<string, Blob> = new Map<string, Blob>();

const IssuesWidget = () => {
  const { auth } = useAuth();
  const isAdmin = auth?.role === "admin";

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

  useEffect(() => {
    (async () => {
      if (!auth?.apiBase || !siteId) return;
      try {
        const res = await fetch(`${auth.apiBase}/list.php?siteId=${encodeURIComponent(siteId)}`);
        const data = await res.json(); // 서버 포맷에 맞게 파싱
        // data → IssueGet 형태로 맵핑(필드명만 맞춰주면 마커 생성 로직 재사용 가능)
        // setCurrentIssues(mapped);
        // allIssues.current = mapped;
      } catch (e) {
        console.error("[Issues] load failed:", e);
      }
    })();
  }, [auth?.apiBase, siteId]);

  /** Initialize Decorator */
  useEffect(() => {
    IssuesApi.enableDecorations(issueDecorator);
    return () => {
      IssuesApi.disableDecorations(issueDecorator);
    };
  }, [issueDecorator]);

  useEffect(() => {
    if (iModelConnection && iModelConnection.iTwinId)
      setContextId(iModelConnection.iTwinId);
  }, [iModelConnection, iModelConnection?.iTwinId]);

  /** When iModel is loaded, get issue details */
  useEffect(() => {
    (async () => {
      if (!siteId) return;
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

      const issueResponses = await Promise.all(promises);
      const iss = issueResponses
        .filter((r) => r?.issue)
        .map((r) => r!.issue as IssueGet);

      const newList = oldIssues.concat(iss);
      setCurrentIssues(newList);
      if (allIssues.current.length === 0)
        allIssues.current = newList;
    })().catch((error) => console.error(error));
  }, [siteId, issueState, issueFilter]);

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

    for (const issue of currentIssues) {
      void createMarker(issue);
    }

  }, [applyView, currentIssues, issueDecorator]);

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
    const g = parseInt(markerFillColor.slice(2, 6), 16);
    const b = parseInt(markerFillColor.slice(4, 8), 16);
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
    if (!siteId) return;
    const type = issueFilter !== "all" ? issueFilter : undefined;
    const state = issueState !== "all" ? issueState : undefined;
    const issuesResp = await IssuesClient.getProjectIssues(siteId, type, state);

    const oldIssues: IssueGet[] = [];
    const promises: Array<Promise<IssueDetailsGet | undefined>> = [];
    issuesResp?.issues?.forEach((issue) => {
      if (issue.id) {
        const found = allIssues.current.find((v) => v.id === issue.id);
        if (found) oldIssues.push(found);
        else promises.push(IssuesClient.getIssueDetails(issue.id));
      }
    });
    const issueResponses = await Promise.all(promises);
    const iss = issueResponses.filter((r) => r?.issue).map((r) => r!.issue as IssueGet);

    const newIssueList = oldIssues.concat(iss);
    setCurrentIssues(newIssueList);
    if (allIssues.current.length === 0) allIssues.current = newIssueList;
  }, [siteId, issueFilter, issueState]);

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

  const issueSummaryContent = () => {
    const columns = [{
      Header: "Table",
      columns: [
        { id: "properties", Header: "Properties", accessor: "prop" },
        { id: "value", Header: "Value", accessor: "val" },
      ],
    }];
    const data = [
      { prop: "Id", val: currentIssue?.id },
      { prop: "Subject", val: currentIssue?.subject },
      { prop: "Status", val: currentIssue?.status },
      { prop: "State", val: currentIssue?.state },
      { prop: "Assignee", val: currentIssue?.assignee?.displayName },
      { prop: "Due Date", val: currentIssue?.dueDate },
      { prop: "Description", val: currentIssue?.description },
      { prop: "Created Date", val: currentIssue?.createdDateTime },
      { prop: "Created By", val: currentIssue?.createdBy },
      { prop: "Assignees", val: currentIssue?.assignees?.reduce((currentString, nextAssignee) => `${currentString} ${nextAssignee.displayName},`, "").slice(0, -1) },
    ];
    return (<Table className={"table"} columns={columns} data={data} emptyTableContent="No data" density="extra-condensed"></Table>);
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
  const onAdd = () => {
    const subject = prompt("Subject?","New issue");
    if (!subject) return;

    // 화면 목록에 즉시 반영(가짜 id)
    const tempId = `tmp-${Date.now()}`;
    const draft: IssueGet = {
      id: tempId,
      subject,
      status: "Open",
      state: "Open",
      type: "Issue",
      displayName: `${tempId} | ${subject}`,
      // 필요하면 modelPin/location 세팅
    };
    setCurrentIssues((prev) => [draft, ...prev]);

    // 서버로 보낼 변경분 큐에 추가
    setPendingIssues((prev) => [
      { subject, status: "Open", type: "Issue" }
    ]);
  };

  // ② Modify: 현재 선택 이슈의 일부 필드 수정(mark as pending)
  const onModify = () => {
    const target = currentIssue;
    if (!target?.id) { alert("수정할 이슈를 먼저 선택하세요."); return; }

    const nextSubject = prompt("New subject?", target.subject || "");
    if (!nextSubject || nextSubject === target.subject) return;

    // 화면 목록 갱신
    setCurrentIssues((prev) => prev.map(it => it.id===target.id ? { ...it, subject: nextSubject, displayName: `${it.id} | ${nextSubject}` } : it));
    setCurrentIssue((prev) => prev ? { ...prev, subject: nextSubject, displayName: `${prev.id} | ${nextSubject}` } : prev);

    // 변경분 큐
    setPendingIssues((prev)=>[
      ...prev,
      { id: target.id!, subject: nextSubject }
    ]);
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
      alert(`Saved: upserts=${res.upserts ?? 0}, deletes=${res.deletes ?? 0}`);
    } catch (e:any) {
      console.error(e);
      alert(`Save failed: ${e?.message || e}`);
    }
  };

  return (
    <>
      <div className={"issues-widget"} >
        {isAdmin ? (
          <div style={{display:"flex", gap:8, alignItems:"center", padding:"8px 12px"}}>
            <Button size="small" onClick={() => {onAdd}}>Add</Button>
            <Button size="small" onClick={() => {onModify}}>Modify</Button>
            <Button size="small" onClick={() => {onDelete}}>Delete</Button>
            <Button size="small" styleType="high-visibility" onClick={() => {onSave}}>Save</Button>
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
        {allIssues.current.length === 0 &&
          <div className="issues-widget-loading">
            <ProgressRadial indeterminate={true} size="small"></ProgressRadial>
          </div>
        }

        {/** When there are no issues retrieved from filter. */}
        {allIssues.current.length !== 0 && currentIssues.length === 0 && <span style={{ color: "#fff", padding: "4px" }}>No Content.</span>}

        {/** When the issues are loaded, display them in a list */}
        {!currentIssue && currentIssues && Object.keys(previewImages).length > 0 && currentIssues.length > 0 &&
          <div>
            {currentIssues.map((issue: IssueGet) => {
              const createdDate = issue.createdDateTime ? new Date(issue.createdDateTime).toLocaleDateString() : undefined;
              const binaryUrl = issue.displayName && previewImages[issue.displayName] ? URL.createObjectURL(previewImages[issue.displayName]) : undefined;
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
                    <Text variant="leading" className={"issue-title"}>{`${issue.number} | ${issue.subject}`}</Text>
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
              <IconButton styleType="borderless" size="small" className="back-button" onClick={() => { setCurrentIssue(undefined); setLinkedElements(undefined); }}><span className="icon icon-chevron-left"></span></IconButton>
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
          defaultState: WidgetState.Floating,
          content: <IssuesWidget />,
        }
      );
    }
    return widgets;
  }
}