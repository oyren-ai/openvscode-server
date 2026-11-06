/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual, strictEqual } from 'assert';
import { decodeBase64 } from '../../../../../../base/common/buffer.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { getPastedImageFile, ITerminalImagePasteHost, pasteImageIntoTerminal, sniffImageMime, TERMINAL_PASTE_IMAGE_COMMAND, TERMINAL_PASTE_IMAGE_MAX_BYTES, TerminalImagePasteResult } from '../../common/terminalImagePaste.js';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const TIFF = new Uint8Array([0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0]);

class FakeHost implements ITerminalImagePasteHost {
	readonly calls: { id: string; arg: { base64: string; mime: string } }[] = [];
	readonly sent: string[] = [];
	readonly warnings: string[] = [];
	constructor(private readonly _reply: (id: string) => Promise<unknown>) { }
	executeCommand(id: string, arg: { base64: string; mime: string }): Promise<unknown> {
		this.calls.push({ id, arg });
		return this._reply(id);
	}
	async sendPath(path: string): Promise<void> {
		this.sent.push(path);
	}
	warn(message: string): void {
		this.warnings.push(message);
	}
}

suite('Terminal image paste', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('sniffImageMime reads the type from the bytes', () => {
		strictEqual(sniffImageMime(PNG), 'image/png');
		strictEqual(sniffImageMime(JPEG), 'image/jpeg');
		strictEqual(sniffImageMime(new TextEncoder().encode('GIF89a......')), 'image/gif');
		strictEqual(sniffImageMime(new TextEncoder().encode('RIFF\x10\0\0\0WEBPVP8 ')), 'image/webp');
		strictEqual(sniffImageMime(new TextEncoder().encode('BM......')), 'image/bmp');
		strictEqual(sniffImageMime(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')), undefined);
		strictEqual(sniffImageMime(TIFF), undefined);
		strictEqual(sniffImageMime(new Uint8Array(0)), undefined);
	});

	test('no image on the clipboard: nothing happens, so the text paste runs as before', async () => {
		const host = new FakeHost(async () => { throw new Error('must not be called'); });
		strictEqual(await pasteImageIntoTerminal(undefined, host), TerminalImagePasteResult.NoImage);
		strictEqual(await pasteImageIntoTerminal(new Uint8Array(0), host), TerminalImagePasteResult.NoImage);
		deepStrictEqual([host.calls, host.sent, host.warnings], [[], [], []]);
	});

	test('an image is uploaded once and the returned sandbox path is typed into the terminal', async () => {
		const host = new FakeHost(async () => ({ path: '/tmp/oyren-terminal-pastes-u/paste-1.png' }));
		strictEqual(await pasteImageIntoTerminal(PNG, host), TerminalImagePasteResult.Pasted);
		strictEqual(host.calls.length, 1);
		strictEqual(host.calls[0].id, TERMINAL_PASTE_IMAGE_COMMAND);
		strictEqual(host.calls[0].id, 'oyren.terminal.pasteImage');
		strictEqual(host.calls[0].arg.mime, 'image/png');
		deepStrictEqual(Array.from(decodeBase64(host.calls[0].arg.base64).buffer), Array.from(PNG));
		deepStrictEqual(host.sent, ['/tmp/oyren-terminal-pastes-u/paste-1.png']);
		deepStrictEqual(host.warnings, []);
	});

	test('the mime sent matches the bytes, not a guess', async () => {
		const host = new FakeHost(async () => ({ path: '/tmp/p/paste-2.jpg' }));
		strictEqual(await pasteImageIntoTerminal(JPEG, host), TerminalImagePasteResult.Pasted);
		strictEqual(host.calls[0].arg.mime, 'image/jpeg');
	});

	test('an image over 10 MB is refused locally with a warning, nothing is uploaded', async () => {
		const big = new Uint8Array(TERMINAL_PASTE_IMAGE_MAX_BYTES + 1);
		big.set(PNG);
		const host = new FakeHost(async () => ({ path: '/never' }));
		strictEqual(await pasteImageIntoTerminal(big, host), TerminalImagePasteResult.Failed);
		strictEqual(host.calls.length, 0);
		strictEqual(host.sent.length, 0);
		strictEqual(host.warnings.length, 1);
		strictEqual(host.warnings[0].includes('10 MB'), true);
	});

	test('an unsupported image format is refused with a warning', async () => {
		const host = new FakeHost(async () => ({ path: '/never' }));
		strictEqual(await pasteImageIntoTerminal(TIFF, host), TerminalImagePasteResult.Failed);
		strictEqual(host.calls.length, 0);
		strictEqual(host.warnings.length, 1);
	});

	test('a missing extension command becomes a warning, never a silent no-op or a thrown error', async () => {
		const host = new FakeHost(async () => { throw new Error(`command '${TERMINAL_PASTE_IMAGE_COMMAND}' not found`); });
		strictEqual(await pasteImageIntoTerminal(PNG, host), TerminalImagePasteResult.Failed);
		strictEqual(host.sent.length, 0);
		strictEqual(host.warnings.length, 1);
	});

	test('the extension\'s error reason reaches the user', async () => {
		const host = new FakeHost(async () => ({ error: '/tmp/x is owned by another user' }));
		strictEqual(await pasteImageIntoTerminal(PNG, host), TerminalImagePasteResult.Failed);
		strictEqual(host.sent.length, 0);
		strictEqual(host.warnings.length, 1);
		strictEqual(host.warnings[0].includes('/tmp/x is owned by another user'), true);
	});

	test('a malformed reply is a failure, nothing is typed', async () => {
		for (const reply of [undefined, null, 42, {}, { path: '' }, { path: 7 }, { path: 'relative/paste.png' }, { path: '/tmp/a\nrm -rf ~' }]) {
			const host = new FakeHost(async () => reply);
			strictEqual(await pasteImageIntoTerminal(PNG, host), TerminalImagePasteResult.Failed, JSON.stringify(reply));
			strictEqual(host.sent.length, 0, JSON.stringify(reply));
			strictEqual(host.warnings.length, 1, JSON.stringify(reply));
		}
	});

	test('getPastedImageFile picks an image file only when the clipboard carries no plain text', () => {
		const fakeFile = { name: 'shot.png' };
		strictEqual(getPastedImageFile(null), undefined);
		strictEqual(getPastedImageFile({
			getData: type => type === 'text/plain' ? 'copied text' : '',
			items: [{ kind: 'file', type: 'image/png', getAsFile: () => fakeFile }],
		}), undefined);
		strictEqual(getPastedImageFile({
			getData: () => '',
			items: [
				{ kind: 'string', type: 'text/html', getAsFile: () => null },
				{ kind: 'file', type: 'application/pdf', getAsFile: () => ({ name: 'doc.pdf' }) },
				{ kind: 'file', type: 'image/png', getAsFile: () => fakeFile },
			],
		}), fakeFile);
	});
});
