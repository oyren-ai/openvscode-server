/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IWorkbenchEnvironmentService } from '../../environment/common/environmentService.js';

/**
 * [persist-exthost] Whether this web workbench was served by a `--persist-exthost` server, read
 * from the boot configuration (`webClientServer` injects `persistRemoteExtHost` into the workbench
 * web configuration). When true, the client suppresses every disconnect goodbye so closing the tab
 * degrades to a socket drop and the server-side extension host keeps running. The duck-typed read
 * keeps this a no-op on desktop, where the environment service carries no web `options` bag.
 */
export function isPersistRemoteExtHost(environmentService: IWorkbenchEnvironmentService): boolean {
	const options = (environmentService as { options?: { persistRemoteExtHost?: boolean } }).options;
	return options?.persistRemoteExtHost === true;
}
