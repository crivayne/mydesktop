/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/
import React, { useEffect } from "react";
import {
    StagePanelLocation,
    StagePanelSection,
    UiItemsProvider,
    useActiveIModelConnection,
    useActiveViewport,
    Widget,
    WidgetState
} from "@itwin/appui-react";
import { ContextRotationId, IModelApp } from "@itwin/core-frontend";
import { ClipShape, ConvexClipPlaneSet } from "@itwin/core-geometry";
import { Alert, Button, LabeledSelect, ToggleSwitch } from "@itwin/itwinui-react";
import ViewClipApi from "./ViewClipApi";
import "./ViewClip.scss";

export const ViewClipWidget = () => {
    const iModelConnection = useActiveIModelConnection();
    const viewport = useActiveViewport();
    const [showClipBlockState, setShowClipBlockState] = React.useState<boolean>(false);
    const [clipPlaneState, setClipPlaneState] = React.useState<string>("None");

    useEffect(() => {
        if (undefined === viewport || undefined === iModelConnection) {
            return;
        }

        if (clipPlaneState === "None" && !showClipBlockState) {
            ViewClipApi.clearClips(viewport);
            return;
        }

        if (showClipBlockState) {
            ViewClipApi.addExtentsClipRange(viewport);
            return;
        }

        ViewClipApi.setClipPlane(viewport, clipPlaneState, iModelConnection);
    }, [showClipBlockState, clipPlaneState, iModelConnection, viewport]);

    /* Handler for plane select */
    const _onPlaneSelectChange = (selectedPlane: string) => {
        setShowClipBlockState(false);
        setClipPlaneState(selectedPlane);
    };

    /* Turn on/off the clip range */
    const _onToggleRangeClip = async (e: React.ChangeEvent<HTMLInputElement>) => {
        setShowClipBlockState(e.target.checked);
        setClipPlaneState("None");
    };

    /* Method for flipping (negating) the current clip plane. */
    const _handleFlipButton = () => {
        const vp = IModelApp.viewManager.selectedView;
        if (undefined === vp) {
            return false;
        }
        // Get the existing clip
        const existingClip = vp.view.getViewClip();
        let planeSet: ConvexClipPlaneSet | undefined;
        if (undefined !== existingClip && 1 === existingClip.clips.length) {
            const existingPrim = existingClip.clips[0];
            if (!(existingPrim instanceof ClipShape)) {
                const existingPlaneSets = existingPrim.fetchClipPlanesRef();
                if (undefined !== existingPlaneSets && 1 === existingPlaneSets.convexSets.length) {
                    planeSet = existingPlaneSets.convexSets[0];
                    // Negate the planeSet
                    planeSet.negateAllPlanes();
                    // This method calls setViewClip. Note that editing the existing clip was not sufficient. The existing clip was edited then passed back to setViewClip.
                    return ViewClipApi.setViewClipFromClipPlaneSet(vp, planeSet);
                }
            }
        }
        return true;
    };

    const options = [
        { value: "None", label: "None" },
        { value: [ContextRotationId.Left].toString(), label: "X" },
        { value: [ContextRotationId.Front].toString(), label: "Y" },
        { value: [ContextRotationId.Top].toString(), label: "Z" },
    ];

    return (
        <div className="sample-options">
            <div className="sample-grid">
                <LabeledSelect label="Clip Plane:" displayStyle="inline" onChange={_onPlaneSelectChange} value={clipPlaneState} options={options} />
                <Button onClick={_handleFlipButton} disabled={clipPlaneState === "None"} styleType="cta">Flip</Button>
                <ToggleSwitch label="Clip Range" checked={showClipBlockState} onChange={_onToggleRangeClip} />
            </div>
            <Alert type="informational" className="instructions">
                Use the options to control the view clip.
            </Alert>
        </div>
    );
};

export class ViewClipWidgetProvider implements UiItemsProvider {
    public readonly id: string = "ViewClipWidgetProvider";

    public provideWidgets(_stageId: string, _stageUsage: string, location: StagePanelLocation, _section?: StagePanelSection): ReadonlyArray<Widget> {
        const widgets: Widget[] = [];
        if (location === StagePanelLocation.Bottom) {
            widgets.push(
                {
                    id: "ViewClipWidget",
                    label: "View Clip Selector",
                    defaultState: WidgetState.Closed,
                    content: <ViewClipWidget />,
                }
            );
        }
        return widgets;
    }
}