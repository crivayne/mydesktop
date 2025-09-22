/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/
import { IModelApp, IModelConnection, Viewport } from "@itwin/core-frontend";
import { Point3d } from "@itwin/core-geometry";
import { InstanceKey, KeySet, KeySetJSON, LabelDefinition, } from "@itwin/presentation-common";
import { Presentation } from "@itwin/presentation-frontend";
import { QueryRowFormat } from "@itwin/core-common";
import { MarkerData, MarkerPinDecorator } from "./marker-pin/MarkerPinDecorator";
import { IssueGet } from "./IssuesClient";

export interface LabelWithId extends LabelDefinition {
  id: string;
    /** 선택 요소의 BBox(있으면 채워짐) */
  range?: { low: Point3d; high: Point3d };
}

export default class IssuesApi {

  public static async getElementKeySet(elementsId: string) {
    if (!elementsId || elementsId.trim().length === 0)
      return new KeySet();

    const keySetJSON: KeySetJSON = JSON.parse(elementsId);
    return KeySet.fromJSON(keySetJSON);
  }

  public static async getElementInfo(iModel: IModelConnection, keySet: KeySet): Promise<LabelWithId[]> {
    const instanceKeys: InstanceKey[] = [];
    keySet.instanceKeys.forEach((currentIds: Set<string>, key: string) => {
      currentIds.forEach((value: string) => { instanceKeys.push({ className: key, id: value }); });
    });

    const labels = await Presentation.presentation.getDisplayLabelDefinitions({ imodel: iModel, keys: instanceKeys });

    return labels.map((label, index) => ({ ...label, id: instanceKeys[index].id }));
  }

  public static setupDecorator() {
    return new MarkerPinDecorator();
  }

  public static addDecoratorPoint(
    decorator: MarkerPinDecorator,
    issue: IssueGet,
    pinImage: HTMLImageElement,
    title?: string,
    description?: string,
    onMouseButtonCallback?: any
  ) {
    const markerData: MarkerData = { point: issue.modelPin?.location ?? Point3d.createZero(), title, description, data: issue };
    const scale = { low: .2, high: 1.4 };
    decorator.addMarkerPoint(markerData, pinImage, title, description, scale, onMouseButtonCallback);
  }

  public static enableDecorations(decorator: MarkerPinDecorator) {
    IModelApp.viewManager.addDecorator(decorator);
  }

  public static disableDecorations(decorator: MarkerPinDecorator) {
    IModelApp.viewManager.dropDecorator(decorator);
  }

  public static clearDecoratorPoints(decorator: MarkerPinDecorator) {
    decorator.clearMarkers();
  }

  // 추가: elementId[]로 라벨 + BBox 조회 (Presentation 라벨 + ECSQL bbox)
  public static async getElementInfoByIds(iModel: IModelConnection, elementIds: string[]): Promise<LabelWithId[]> {
    if (!elementIds.length) return [];

    const inList = elementIds.map((id) => `'${id}'`).join(",");

    // 1) 라벨
    const keys: InstanceKey[] = elementIds.map((id) => ({ className: "bis.Element", id }));
    const labels = await Presentation.presentation.getDisplayLabelDefinitions({ imodel: iModel, keys });

    // 2) bbox (GeometricElement3d에 BBoxLow/High, 없는 애는 null)
    const rows: any[] = [];
    const ecsql = `
      SELECT
        e.ECInstanceId AS id,
        ge.BBoxLow    AS low,
        ge.BBoxHigh   AS high
      FROM bis.Element e
      LEFT JOIN bis.GeometricElement3d ge ON ge.ECInstanceId = e.ECInstanceId
      WHERE e.ECInstanceId IN (${inList})
    `;

    // 4.x 방식
    const reader = iModel.createQueryReader(ecsql, undefined, {
      rowFormat: QueryRowFormat.UseECSqlPropertyNames,
    });
    for await (const row of reader) {
      rows.push(row);
    }

    // 3) merge
    const bboxById = new Map<string, { low?: any; high?: any }>();
    rows.forEach((r) => bboxById.set(r.id, { low: r.low, high: r.high }));

    return elementIds.map((id, idx) => {
      const label = labels[idx];
      const bbox = bboxById.get(id);
      const range = (bbox?.low && bbox?.high)
        ? { low: Point3d.fromJSON(bbox.low), high: Point3d.fromJSON(bbox.high) }
        : undefined;
      return {
        ...label,
        id,
        range,
      };
    });
  }

  // KeySet(JSON 문자열) → elementId[] 파서 (UI·서버 양쪽에서 동일 규칙 사용)
  public static parseElementIds(raw?: string): string[] {
    if (!raw) return [];
    try {
      const kj = JSON.parse(raw);
      const arr = kj?.instanceKeys?.["bis.Element"];
      if (Array.isArray(arr)) return arr.map(String);
    } catch {
      // 공백 구분 "0x123 0x456" 형태
      return raw.split(/\s+/).filter(Boolean);
    }
    return [];
  }

  // elementId[] → 공백 구분 문자열 (DB 저장용)
  public static joinElementIds(ids: string[]): string {
    return ids.join(" ");
  }

  // 여러 bbox 합쳐서 전체 중심점
  public static centerOf(infos: LabelWithId[]): Point3d | undefined {
    const lows: Point3d[] = [];
    const highs: Point3d[] = [];
    for (const info of infos) {
      if (info.range?.low && info.range?.high) {
        lows.push(info.range.low);
        highs.push(info.range.high);
      }
    }
    if (!lows.length) return undefined;
    const min = Point3d.create(
      Math.min(...lows.map((p) => p.x)),
      Math.min(...lows.map((p) => p.y)),
      Math.min(...lows.map((p) => p.z))
    );
    const max = Point3d.create(
      Math.max(...highs.map((p) => p.x)),
      Math.max(...highs.map((p) => p.y)),
      Math.max(...highs.map((p) => p.z))
    );
    return Point3d.create((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2);
  }

  // 현재 뷰의 SelectionSet → elementId[]
  public static pickCurrentSelectionIds(vp: Viewport): string[] {
    const sel = vp.iModel.selectionSet;
    const ids: string[] = [];
    sel.elements.forEach((id) => ids.push(id));
    return ids;
  }

  // 한 번 클릭하여 월드 좌표 얻기 (간단 임시 헬퍼)
  public static promptForPointOnce(vp: Viewport): Promise<Point3d | undefined> {
    return new Promise((resolve) => {
      const onDown = (ev: PointerEvent) => {
        const pt = vp.viewToWorld({ x: ev.clientX, y: ev.clientY, z: 0 });
        resolve(Point3d.create(pt.x, pt.y, pt.z));
        cleanup();
      };
      const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") { resolve(undefined); cleanup(); } };
      function cleanup() {
        window.removeEventListener("pointerdown", onDown as any);
        window.removeEventListener("keydown", onEsc as any);
      }
      window.addEventListener("pointerdown", onDown as any, { once: true });
      window.addEventListener("keydown", onEsc as any);
    });
  }

  public static async getElementCenter(iModel: IModelConnection, elementId: string): Promise<Point3d | undefined> {
    const infos = await this.getElementInfoByIds(iModel, [elementId]);
    return this.centerOf(infos);
  }
}