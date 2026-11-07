/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Oyren: paste a clipboard image into the terminal. The sandbox (where the shell and CLI agents run)
// cannot read the user's clipboard, so the workbench uploads the image to the oyren-agent extension,
// which saves it in a 0700 per-session subdirectory under a 0700 per-user root directory in the
// sandbox and returns the path; the path is then typed into the terminal the same way a dropped file
// is, and Claude Code attaches it as an image.
//
// Threat model & mitigations:
// - Every process in a Codespace sandbox (including the terminal shell and Claude Code) runs as the
//   same Unix UID, so 0700/0600 file modes isolate against other OS users, not same-UID processes.
// - Each terminal instance passes its own unguessable 128-bit `sessionId` and calls
//   TERMINAL_CLEANUP_PASTE_SESSION_COMMAND when disposed so pasted screenshots are removed on
//   terminal close as well as by the extension host's TTL and aggregate byte/count quotas.
// - Keep TERMINAL_PASTE_IMAGE_MAX_BYTES and sniffImageMime in sync with MAX_PASTE_BYTES and
//   sniffImageType in oyren/extensions/oyren-agent-extension/terminalPaste.js.

import { encodeBase64, VSBuffer } from '../../../../../base/common/buffer.js';
import { isObject } from '../../../../../base/common/types.js';
import { localize } from '../../../../../nls.js';

export const TERMINAL_PASTE_IMAGE_COMMAND = 'oyren.terminal.pasteImage';
export const TERMINAL_CLEANUP_PASTE_SESSION_COMMAND = 'oyren.terminal.cleanupPasteSession';

// Keep in sync with MAX_PASTE_BYTES in oyren/extensions/oyren-agent-extension/terminalPaste.js.
export const TERMINAL_PASTE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

export const enum TerminalImagePasteResult {
	/** No image on the clipboard: the caller pastes text as usual. */
	NoImage,
	Pasted,
	/** There was an image but it could not be pasted; the user has been told why. */
	Failed,
}

export interface ITerminalImagePasteHost {
	readonly sessionId?: string;
	executeCommand(id: string, arg: { base64: string; mime: string; sessionId?: string }): Promise<unknown>;
	sendPath(path: string): Promise<void>;
	warn(message: string): void;
}

export interface IPastedImageFile {
	readonly size: number;
	arrayBuffer(): Promise<ArrayBuffer>;
}

export interface IPasteClipboardData<TFile> {
	getData(type: string): string;
	readonly items: ArrayLike<{ readonly kind: string; readonly type: string; getAsFile(): TFile | null }>;
}

/**
 * The image file of a native paste event, but only when the clipboard has no text: text always
 * pastes as text (some apps put both on the clipboard).
 */
export function getPastedImageFile<TFile>(data: IPasteClipboardData<TFile> | null | undefined): TFile | undefined {
	if (!data || data.getData('text/plain')) {
		return undefined;
	}
	for (const item of Array.from(data.items)) {
		if (item.kind === 'file' && item.type.startsWith('image/')) {
			return item.getAsFile() ?? undefined;
		}
	}
	return undefined;
}

function startsWith(bytes: Uint8Array, offset: number, magic: number[]): boolean {
	if (bytes.length < offset + magic.length) {
		return false;
	}
	return magic.every((b, i) => bytes[offset + i] === b);
}

/**
 * The image type by magic bytes, for the formats the extension accepts. No SVG.
 * Keep in sync with sniffImageType in oyren/extensions/oyren-agent-extension/terminalPaste.js.
 */
export function sniffImageMime(bytes: Uint8Array): string | undefined {
	if (startsWith(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
		return 'image/png';
	}
	if (startsWith(bytes, 0, [0xff, 0xd8, 0xff])) {
		return 'image/jpeg';
	}
	if (startsWith(bytes, 0, [0x47, 0x49, 0x46, 0x38])) {
		return 'image/gif';
	}
	if (startsWith(bytes, 0, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, 8, [0x57, 0x45, 0x42, 0x50])) {
		return 'image/webp';
	}
	if (startsWith(bytes, 0, [0x42, 0x4d])) {
		return 'image/bmp';
	}
	return undefined;
}

function failed(host: ITerminalImagePasteHost, reason: string): TerminalImagePasteResult {
	host.warn(localize('terminal.imagePaste.failed', "Could not paste the image into the terminal: {0}", reason));
	return TerminalImagePasteResult.Failed;
}

/**
 * Preflights `file.size` against `TERMINAL_PASTE_IMAGE_MAX_BYTES` before allocating `arrayBuffer()`,
 * then delegates to `pasteImageIntoTerminal`.
 */
export async function pasteImageFileIntoTerminal(file: IPastedImageFile | undefined, host: ITerminalImagePasteHost): Promise<TerminalImagePasteResult> {
	if (!file || file.size === 0) {
		return TerminalImagePasteResult.NoImage;
	}
	if (file.size > TERMINAL_PASTE_IMAGE_MAX_BYTES) {
		return failed(host, localize('terminal.imagePaste.tooLarge', "the image is larger than 10 MB."));
	}
	let buffer: ArrayBuffer;
	try {
		buffer = await file.arrayBuffer();
	} catch (err) {
		return failed(host, err instanceof Error ? err.message : localize('terminal.imagePaste.readFailed', "could not read the pasted image."));
	}
	return pasteImageIntoTerminal(new Uint8Array(buffer), host);
}

export async function pasteImageIntoTerminal(bytes: Uint8Array | undefined, host: ITerminalImagePasteHost): Promise<TerminalImagePasteResult> {
	if (!bytes || bytes.byteLength === 0) {
		return TerminalImagePasteResult.NoImage;
	}
	if (bytes.byteLength > TERMINAL_PASTE_IMAGE_MAX_BYTES) {
		return failed(host, localize('terminal.imagePaste.tooLarge', "the image is larger than 10 MB."));
	}
	const mime = sniffImageMime(bytes);
	if (!mime) {
		return failed(host, localize('terminal.imagePaste.unsupported', "only PNG, JPEG, GIF, WebP and BMP images are supported."));
	}

	let reply: unknown;
	try {
		const payload: { base64: string; mime: string; sessionId?: string } = {
			base64: encodeBase64(VSBuffer.wrap(bytes)),
			mime,
		};
		if (host.sessionId) {
			payload.sessionId = host.sessionId;
		}
		reply = await host.executeCommand(TERMINAL_PASTE_IMAGE_COMMAND, payload);
	} catch (err) {
		return failed(host, err instanceof Error ? err.message : String(err));
	}

	const record = isObject(reply) ? reply as { path?: unknown; error?: unknown } : undefined;
	const path = record?.path;
	// Only an absolute single-line path is typed into a shell.
	if (typeof path === 'string' && path.startsWith('/') && !/[\r\n\0]/.test(path)) {
		try {
			await host.sendPath(path);
		} catch (err) {
			return failed(host, err instanceof Error ? err.message : String(err));
		}
		return TerminalImagePasteResult.Pasted;
	}
	const error = typeof record?.error === 'string' ? record.error : undefined;
	return failed(host, error ?? localize('terminal.imagePaste.noPath', "the editor extension did not return a file path."));
}
