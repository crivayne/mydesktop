"use strict";
/*---------------------------------------------------------------------------------------------
 * Copyright (c) Bentley Systems, Incorporated. All rights reserved.
 * See LICENSE.md in the project root for license terms and full copyright notice.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppLoggerCategory = void 0;
/** List of LoggerCategories for this app.  For more details on Logging Categories, check out the [Category](https://www.imodeljs.org/learning/common/logging/#categories) documentation. */
var AppLoggerCategory;
(function (AppLoggerCategory) {
    AppLoggerCategory["Frontend"] = "iTwinViewer.Frontend";
    AppLoggerCategory["Backend"] = "iTwinViewer.Backend";
})(AppLoggerCategory || (exports.AppLoggerCategory = AppLoggerCategory = {}));
