/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/
import React from "react";
import "./Divider.scss";

export interface DividerComponentState {
  left: number;
}

export interface DividerComponentProps {
  bounds: DOMRect;
  menuChildren?: React.ReactNode;
  leftChildren?: React.ReactNode;
  rightChildren?: React.ReactNode;
  onDragged?: (leftPanelWidth: number, rightPanelWidth: number) => void;
  buffer?: number;
  sideL?: number;
  sideR?: number;
}

export class DividerHandleComponent extends React.Component<{}, {}> {
  public render() {
    return <div className={"grab-handle"} id={"grabber-div"}></div>;
  }
}

export class DividerComponent extends React.Component<DividerComponentProps, {}> {
  public state: DividerComponentState;

  private _oldPosition: number = 0;
  private _elem?: HTMLElement;
  private _container: HTMLElement | null = null;

  private get _buffer(): number {
    return undefined === this.props.buffer ? 0 : this.props.buffer;
  }
  private get _width(): number {
    let width: number = 0;
    if (null === this._container)
      return width;
    const widthStr = window.getComputedStyle(this._container)?.getPropertyValue("width");
    if (undefined !== widthStr && widthStr)
      width = parseInt(widthStr, 10);
    return width;
  }
  private limitToBounds(n: number): number {
    n = Math.min(n, this.props.bounds.right - (this._elem!.clientWidth + this._buffer));
    n = Math.max(n, this.props.bounds.left + this._buffer);
    return n;
  }

  constructor(props: DividerComponentProps) {
    super(props);

    let left: number;
    if (undefined !== props.sideL)
      left = props.sideL + props.bounds.left;
    else if (undefined !== props.sideR)
      left = props.bounds.right - props.sideR;
    else
      left = props.bounds.left + props.bounds.width / 2;

    left = Math.min(left, this.props.bounds.right - this._buffer);
    left = Math.max(left, this.props.bounds.left + this._buffer);

    this.state = { left };
  }

  public componentDidUpdate(prevProps: DividerComponentProps, prevState: DividerComponentState) {
    const currentBounds = this.props.bounds;
    if (currentBounds.height !== prevProps.bounds.height
      || currentBounds.width !== prevProps.bounds.width) {
      const left = ((this.state.left - prevProps.bounds.left) / prevProps.bounds.width) * this.props.bounds.width + this.props.bounds.left;
      this.setState({ left });
    }

    if (this.state.left !== prevState.left)
      this.onDraggedCallback();
  }

  private _mouseDownDraggable = (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
    // 브라우저/뷰어 기본 동작 차단 + 버블링 차단
    e.preventDefault();
    e.stopPropagation();

    // 드래그 시작 상태 저장
    this._oldPosition = e.clientX;
    this._elem = e.currentTarget;

    // 전역 캡처 리스너로 등록(기본 툴보다 먼저 먹음)
    window.addEventListener("mousemove", this._mouseMoveDraggable, true); // capture
    window.addEventListener("mouseup", this._mouseUpDraggable, true);     // capture
  };

  private _mouseMoveDraggable = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (undefined === this._elem) return;

    const next = this.limitToBounds(this._elem.offsetLeft - (this._oldPosition - e.clientX));
    this._oldPosition = this.limitToBounds(e.clientX);

    // 상태 갱신 후 onDragged 콜백을 즉시 호출
    this.setState({ left: next }, () => this.onDraggedCallback());
  };

  private onDraggedCallback(): void {
    const left = this.state.left - this.props.bounds.left;
    const right = this.props.bounds.width - left - this._width;
    if (undefined !== this.props.onDragged)
      this.props.onDragged(left, right);
  }

  private _mouseUpDraggable = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    window.removeEventListener("mousemove", this._mouseMoveDraggable, true);
    window.removeEventListener("mouseup", this._mouseUpDraggable, true);

    // 드래그 종료 시 한 번 더 콜백(선택)
    this.onDraggedCallback();
  };

  // There must be a better way to set panels on either side of the divider.
  public render() {
    const left = this.state.left;
    const { bounds } = this.props;

    return (
      <>
        <div
          id={"divider-panel-left"}
          className={"divider-panel"}
          style={{
            position: "absolute",
            top: bounds.top,
            height: bounds.height,
            left: bounds.left,
            width: left,
            overflow: "hidden",
          }}
        >
          {this.props.leftChildren}
        </div>

        <div
          id={"divider-panel-right"}
          className={"divider-panel"}
          style={{
            position: "absolute",
            top: bounds.top,
            height: bounds.height,
            left,
            width: bounds.right - left,
            overflow: "hidden",
          }}
        >
          {this.props.rightChildren}
        </div>

        <div
          className={"dividing-line"}
          ref={(el) => (this._container = el)}
          style={{
            position: "absolute",
            left,
            top: bounds.top,
            height: bounds.height,
            width: 6,
            cursor: "ew-resize",
            zIndex: 1001,
            pointerEvents: "auto",
            background: "rgba(180,180,180,0.7)",
            borderLeft: "1px solid rgba(255,255,255,0.8)",
            borderRight: "1px solid rgba(0,0,0,0.2)",
          }}
          id={"divider-div"}
          role="presentation"
          onMouseDown={this._mouseDownDraggable}
          onClick={(ev) => { ev.preventDefault(); ev.stopPropagation(); }}
          onDoubleClick={(ev) => { ev.preventDefault(); ev.stopPropagation(); }}
        >
          {this.props.menuChildren ? this.props.menuChildren : <DividerHandleComponent />}
        </div>
      </>
    );
  }
}