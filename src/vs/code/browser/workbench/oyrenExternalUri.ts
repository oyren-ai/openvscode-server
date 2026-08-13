/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mainWindow } from '../../../base/browser/window.js';
import { URI } from '../../../base/common/uri.js';
import { extractLocalHostUriMetaDataForPortMapping } from '../../../platform/tunnel/common/tunnel.js';
import type { IExternalUriResolver } from '../../../workbench/browser/web.api.js';

/**
 * In Oyren deployments the workbench runs iframed on oyren.ai, so a literal
 * `http://localhost:<port>` link resolves on the END USER's machine — where
 * nothing is listening — and Chromium's Local Network Access policy blocks the
 * request outright. The Oyren session router instead serves a token-gated
 * proxy for arbitrary loopback ports of the sandbox at
 * `/_oyren/port/<token>/<port>/...`. The token is mandatory — an
 * unauthenticated proxy would expose the editor port itself, bypassing its
 * auth. It is derived from our own base path: the workbench is served at
 * `/_oyren/ide/<token>`, the same token the port proxy expects.
 *
 * Outside Oyren (stock/self-hosted installs, no `/_oyren/ide/...` base path)
 * this returns `undefined`, keeping upstream behavior untouched.
 */
export function createOyrenExternalUriResolver(serverBasePath: string | undefined): IExternalUriResolver | undefined {
	const match = serverBasePath ? /^\/_oyren\/ide\/([^/]+)/.exec(serverBasePath) : null;
	if (!match) {
		return undefined;
	}
	const token = match[1];

	return async (uri: URI): Promise<URI> => {
		const localhost = extractLocalHostUriMetaDataForPortMapping(uri);
		if (!localhost) {
			return uri;
		}
		return URI.parse(mainWindow.location.origin).with({
			path: `/_oyren/port/${token}/${localhost.port}${uri.path || '/'}`,
			query: uri.query,
			fragment: uri.fragment
		});
	};
}
