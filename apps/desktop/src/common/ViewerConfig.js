"use strict";
/*---------------------------------------------------------------------------------------------
 * Copyright (c) Bentley Systems, Incorporated. All rights reserved.
 * See LICENSE.md in the project root for license terms and full copyright notice.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.viewerRpcs = exports.channelName = void 0;
const core_common_1 = require("@itwin/core-common");
const presentation_common_1 = require("@itwin/presentation-common");
const ecschema_rpcinterface_common_1 = require("@itwin/ecschema-rpcinterface-common");
exports.channelName = (0, core_common_1.iTwinChannel)("desktop-viewer");
/** RPC interfaces required by the viewer */
exports.viewerRpcs = [
    core_common_1.IModelReadRpcInterface,
    core_common_1.IModelTileRpcInterface,
    presentation_common_1.PresentationRpcInterface,
    core_common_1.SnapshotIModelRpcInterface, // eslint-disable-line @typescript-eslint/no-deprecated
    ecschema_rpcinterface_common_1.ECSchemaRpcInterface
];
