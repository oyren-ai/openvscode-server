/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Terminal as RawXtermTerminal } from '@xterm/xterm';
import { Disposable, toDisposable, type IDisposable } from '../../../../../base/common/lifecycle.js';
import { IClipboardService } from '../../../../../platform/clipboard/common/clipboardService.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IDetachedTerminalInstance, isDetachedTerminalInstance, ITerminalConfigurationService, ITerminalContribution, ITerminalInstance, type IXtermTerminal } from '../../../terminal/browser/terminal.js';
import { registerTerminalContribution, type IDetachedCompatibleTerminalContributionContext, type ITerminalContributionContext } from '../../../terminal/browser/terminalExtensions.js';
import { shouldPasteTerminalText } from './terminalClipboard.js';
import { Emitter } from '../../../../../base/common/event.js';
import { BrowserFeatures } from '../../../../../base/browser/canIUse.js';
import { TerminalCapability, type ITerminalCommand } from '../../../../../platform/terminal/common/capabilities/capabilities.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TerminalSettingId } from '../../../../../platform/terminal/common/terminal.js';
import { isLinux, isMacintosh } from '../../../../../base/common/platform.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { registerActiveInstanceAction, registerActiveXtermAction } from '../../../terminal/browser/terminalActions.js';
import { TerminalCommandId } from '../../../terminal/common/terminal.js';
import { localize2 } from '../../../../../nls.js';
import { ContextKeyExpr } from '../../../../../platform/contextkey/common/contextkey.js';
import { TerminalContextKeys } from '../../../terminal/common/terminalContextKey.js';
import { KeyCode, KeyMod } from '../../../../../base/common/keyCodes.js';
import { KeybindingWeight } from '../../../../../platform/keybinding/common/keybindingsRegistry.js';
import { terminalStrings } from '../../../terminal/common/terminalStrings.js';
import { isString } from '../../../../../base/common/types.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import * as dom from '../../../../../base/browser/dom.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { getPastedImageFile, IPastedImageFile, ITerminalImagePasteHost, pasteImageFileIntoTerminal, pasteImageIntoTerminal, TERMINAL_CLEANUP_PASTE_SESSION_COMMAND, TerminalImagePasteResult } from '../common/terminalImagePaste.js';

// #region Terminal Contributions

export class TerminalClipboardContribution extends Disposable implements ITerminalContribution {
	static readonly ID = 'terminal.clipboard';

	static get(instance: ITerminalInstance | IDetachedTerminalInstance): TerminalClipboardContribution | null {
		return instance.getContribution<TerminalClipboardContribution>(TerminalClipboardContribution.ID);
	}

	private _xterm: IXtermTerminal & { raw: RawXtermTerminal } | undefined;

	private _overrideCopySelection: boolean | undefined = undefined;
	private readonly _pasteSessionId = generateUuid().replace(/-/g, '');
	private _hasPastedImage = false;

	private readonly _onWillPaste = this._register(new Emitter<string>());
	readonly onWillPaste = this._onWillPaste.event;
	private readonly _onDidPaste = this._register(new Emitter<string>());
	readonly onDidPaste = this._onDidPaste.event;

	constructor(
		private readonly _ctx: ITerminalContributionContext | IDetachedCompatibleTerminalContributionContext,
		@IClipboardService private readonly _clipboardService: IClipboardService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@INotificationService private readonly _notificationService: INotificationService,
		@ITerminalConfigurationService private readonly _terminalConfigurationService: ITerminalConfigurationService,
		@ICommandService private readonly _commandService: ICommandService,
	) {
		super();
		this._register(toDisposable(() => {
			if (this._hasPastedImage) {
				this._commandService.executeCommand(TERMINAL_CLEANUP_PASTE_SESSION_COMMAND, { sessionId: this._pasteSessionId }).then(undefined, () => { });
			}
		}));
	}

	xtermOpen(xterm: IXtermTerminal & { raw: RawXtermTerminal }): void {
		// Oyren: a native paste event only reaches the terminal when the paste keybinding did not run
		// (no async clipboard API in this browser, or paste from the browser's own menu). Take it over
		// only when it carries an image and no text; everything else goes to xterm as before.
		const element = xterm.raw.element;
		if (!element || !this._canPasteImage()) {
			return;
		}
		this._register(dom.addDisposableListener(element, dom.EventType.PASTE, (e: ClipboardEvent) => {
			const file = getPastedImageFile(e.clipboardData);
			if (!file) {
				return;
			}
			e.preventDefault();
			e.stopImmediatePropagation();
			void this._pasteImageFile(file);
		}, true));
	}

	xtermReady(xterm: IXtermTerminal & { raw: RawXtermTerminal }): void {
		this._xterm = xterm;
		// TODO: This should be a different event on xterm, copying html should not share the requesting run command event
		this._register(xterm.onDidRequestCopyAsHtml(e => this.copySelection(true, e.command)));
		this._register(xterm.raw.onSelectionChange(async () => {
			if (this._configurationService.getValue(TerminalSettingId.CopyOnSelection)) {
				if (this._overrideCopySelection === false) {
					return;
				}
				if (this._ctx.instance.hasSelection()) {
					await this.copySelection();
				}
			}
		}));
	}

	async copySelection(asHtml?: boolean, command?: ITerminalCommand): Promise<void> {
		// TODO: Confirm this is fine that it's no longer awaiting xterm promise
		this._xterm?.copySelection(asHtml, command);
	}

	/**
	 * Focuses and pastes the contents of the clipboard into the terminal instance.
	 *
	 * Oyren: when the clipboard holds an image and no text (a screenshot), the image is saved in the
	 * sandbox by the oyren-agent extension and its path is typed in, so CLI agents such as Claude
	 * Code can attach it. Text on the clipboard always wins, so text paste is unchanged.
	 */
	async paste(): Promise<void> {
		const text = await this._clipboardService.readText();
		if (!text && this._canPasteImage() && await this._pasteClipboardImage() !== TerminalImagePasteResult.NoImage) {
			return;
		}
		await this._paste(text);
	}

	/**
	 * Focuses and pastes the contents of the selection clipboard into the terminal instance.
	 */
	async pasteSelection(): Promise<void> {
		await this._paste(await this._clipboardService.readText('selection'));
	}

	private _canPasteImage(): boolean {
		// Detached terminals (e.g. chat output) have no shell to type a path into.
		return !isDetachedTerminalInstance(this._ctx.instance);
	}

	private _createImagePasteHost(instance: ITerminalInstance): ITerminalImagePasteHost {
		return {
			sessionId: this._pasteSessionId,
			executeCommand: (id, arg) => {
				this._hasPastedImage = true;
				return this._commandService.executeCommand(id, arg);
			},
			sendPath: async path => {
				instance.focus();
				await instance.sendText(await instance.preparePathForShell(path), false, true);
			},
			warn: message => this._notificationService.warn(message),
		};
	}

	private async _pasteImageFile(file: IPastedImageFile): Promise<TerminalImagePasteResult> {
		const instance = this._ctx.instance;
		if (isDetachedTerminalInstance(instance)) {
			return TerminalImagePasteResult.NoImage;
		}
		return pasteImageFileIntoTerminal(file, this._createImagePasteHost(instance));
	}

	private async _readBrowserClipboardImageBlob(): Promise<IPastedImageFile | undefined> {
		try {
			const clipboard = mainWindow.navigator?.clipboard;
			if (!clipboard || typeof clipboard.read !== 'function') {
				return undefined;
			}
			const items = await clipboard.read();
			const item = items[0];
			if (!item) {
				return undefined;
			}
			const supportedTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp'];
			const mime = supportedTypes.find(type => item.types.includes(type));
			if (!mime) {
				return undefined;
			}
			return await item.getType(mime);
		} catch {
			return undefined;
		}
	}

	private async _pasteClipboardImage(): Promise<TerminalImagePasteResult> {
		const instance = this._ctx.instance;
		if (isDetachedTerminalInstance(instance)) {
			return TerminalImagePasteResult.NoImage;
		}
		const host = this._createImagePasteHost(instance);
		const blob = await this._readBrowserClipboardImageBlob();
		if (blob) {
			return pasteImageFileIntoTerminal(blob, host);
		}
		return pasteImageIntoTerminal(await this._clipboardService.readImage(), host);
	}

	private async _paste(value: string): Promise<void> {
		if (!this._xterm) {
			return;
		}

		let currentText = value;
		const shouldPasteText = await this._instantiationService.invokeFunction(shouldPasteTerminalText, currentText, this._xterm?.raw.modes.bracketedPasteMode);
		if (!shouldPasteText) {
			return;
		}

		if (typeof shouldPasteText === 'object') {
			currentText = shouldPasteText.modifiedText;
		}

		this._ctx.instance.focus();

		this._onWillPaste.fire(currentText);
		this._xterm.raw.paste(currentText);
		this._onDidPaste.fire(currentText);
	}

	async handleMouseEvent(event: MouseEvent): Promise<{ handled: boolean } | void> {
		switch (event.button) {
			case 1: { // Middle click
				if (this._terminalConfigurationService.config.middleClickBehavior === 'paste') {
					this.paste();
					return { handled: true };
				}
				break;
			}
			case 2: { // Right click
				// Ignore shift click as it forces the context menu
				if (event.shiftKey) {
					return;
				}
				const rightClickBehavior = this._terminalConfigurationService.config.rightClickBehavior;
				if (rightClickBehavior !== 'copyPaste' && rightClickBehavior !== 'paste') {
					return;
				}
				if (rightClickBehavior === 'copyPaste' && this._ctx.instance.hasSelection()) {
					await this.copySelection();
					this._ctx.instance.clearSelection();
				} else {
					if (BrowserFeatures.clipboard.readText) {
						this.paste();
					} else {
						this._notificationService.info(`This browser doesn't support the clipboard.readText API needed to trigger a paste, try ${isMacintosh ? '⌘' : 'Ctrl'}+V instead.`);
					}
				}
				// Clear selection after all click event bubbling is finished on Mac to prevent
				// right-click selecting a word which is seemed cannot be disabled. There is a
				// flicker when pasting but this appears to give the best experience if the
				// setting is enabled.
				if (isMacintosh) {
					setTimeout(() => this._ctx.instance.clearSelection(), 0);
				}
				return { handled: true };
			}
		}
	}

	/**
	 * Override the copy on selection feature with a custom value.
	 * @param value Whether to enable copySelection.
	 */
	overrideCopyOnSelection(value: boolean): IDisposable {
		if (this._overrideCopySelection !== undefined) {
			throw new Error('Cannot set a copy on selection override multiple times');
		}
		this._overrideCopySelection = value;
		return toDisposable(() => this._overrideCopySelection = undefined);
	}
}

registerTerminalContribution(TerminalClipboardContribution.ID, TerminalClipboardContribution, false);

// #endregion

// #region Actions

const terminalAvailableWhenClause = ContextKeyExpr.or(TerminalContextKeys.processSupported, TerminalContextKeys.terminalHasBeenCreated);

// TODO: Move these commands into this terminalContrib/
registerActiveInstanceAction({
	id: TerminalCommandId.CopyLastCommand,
	title: localize2('workbench.action.terminal.copyLastCommand', "Copy Last Command"),
	precondition: terminalAvailableWhenClause,
	run: async (instance, c, accessor) => {
		const clipboardService = accessor.get(IClipboardService);
		const commands = instance.capabilities.get(TerminalCapability.CommandDetection)?.commands;
		if (!commands || commands.length === 0) {
			return;
		}
		const command = commands[commands.length - 1];
		if (!command.command) {
			return;
		}
		await clipboardService.writeText(command.command);
	}
});

registerActiveInstanceAction({
	id: TerminalCommandId.CopyLastCommandOutput,
	title: localize2('workbench.action.terminal.copyLastCommandOutput', "Copy Last Command Output"),
	precondition: terminalAvailableWhenClause,
	run: async (instance, c, accessor) => {
		const clipboardService = accessor.get(IClipboardService);
		const commands = instance.capabilities.get(TerminalCapability.CommandDetection)?.commands;
		if (!commands || commands.length === 0) {
			return;
		}
		const command = commands[commands.length - 1];
		if (!command?.hasOutput()) {
			return;
		}
		const output = command.getOutput();
		if (isString(output)) {
			await clipboardService.writeText(output);
		}
	}
});

registerActiveInstanceAction({
	id: TerminalCommandId.CopyLastCommandAndLastCommandOutput,
	title: localize2('workbench.action.terminal.copyLastCommandAndOutput', "Copy Last Command and Output"),
	precondition: terminalAvailableWhenClause,
	run: async (instance, c, accessor) => {
		const clipboardService = accessor.get(IClipboardService);
		const commands = instance.capabilities.get(TerminalCapability.CommandDetection)?.commands;
		if (!commands || commands.length === 0) {
			return;
		}
		const command = commands[commands.length - 1];
		if (!command?.hasOutput()) {
			return;
		}
		const output = command.getOutput();
		if (isString(output)) {
			await clipboardService.writeText(`${command.command !== '' ? command.command + '\n' : ''}${output}`);
		}
	}
});

// Some commands depend on platform features
if (BrowserFeatures.clipboard.writeText) {
	registerActiveXtermAction({
		id: TerminalCommandId.CopySelection,
		title: localize2('workbench.action.terminal.copySelection', 'Copy Selection'),
		// TODO: Why is copy still showing up when text isn't selected?
		precondition: ContextKeyExpr.or(TerminalContextKeys.textSelectedInFocused, ContextKeyExpr.and(terminalAvailableWhenClause, TerminalContextKeys.textSelected)),
		keybinding: [{
			primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyC,
			mac: { primary: KeyMod.CtrlCmd | KeyCode.KeyC },
			weight: KeybindingWeight.WorkbenchContrib,
			when: ContextKeyExpr.or(
				ContextKeyExpr.and(TerminalContextKeys.textSelected, TerminalContextKeys.focus),
				TerminalContextKeys.textSelectedInFocused,
			)
		}],
		run: (activeInstance) => activeInstance.copySelection()
	});

	registerActiveXtermAction({
		id: TerminalCommandId.CopyAndClearSelection,
		title: localize2('workbench.action.terminal.copyAndClearSelection', 'Copy and Clear Selection'),
		precondition: ContextKeyExpr.or(TerminalContextKeys.textSelectedInFocused, ContextKeyExpr.and(terminalAvailableWhenClause, TerminalContextKeys.textSelected)),
		keybinding: [{
			win: { primary: KeyMod.CtrlCmd | KeyCode.KeyC },
			weight: KeybindingWeight.WorkbenchContrib,
			when: ContextKeyExpr.or(
				ContextKeyExpr.and(TerminalContextKeys.textSelected, TerminalContextKeys.focus),
				TerminalContextKeys.textSelectedInFocused,
			)
		}],
		run: async (xterm) => {
			await xterm.copySelection();
			xterm.clearSelection();
		}
	});

	registerActiveXtermAction({
		id: TerminalCommandId.CopySelectionAsHtml,
		title: localize2('workbench.action.terminal.copySelectionAsHtml', 'Copy Selection as HTML'),
		f1: true,
		category: terminalStrings.actionCategory,
		precondition: ContextKeyExpr.or(TerminalContextKeys.textSelectedInFocused, ContextKeyExpr.and(terminalAvailableWhenClause, TerminalContextKeys.textSelected)),
		run: (xterm) => xterm.copySelection(true)
	});
}

if (BrowserFeatures.clipboard.readText) {
	registerActiveInstanceAction({
		id: TerminalCommandId.Paste,
		title: localize2('workbench.action.terminal.paste', 'Paste into Active Terminal'),
		precondition: terminalAvailableWhenClause,
		keybinding: [{
			primary: KeyMod.CtrlCmd | KeyCode.KeyV,
			win: { primary: KeyMod.CtrlCmd | KeyCode.KeyV, secondary: [KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyV] },
			linux: { primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyV },
			weight: KeybindingWeight.WorkbenchContrib,
			when: TerminalContextKeys.focus
		}],
		run: (activeInstance) => TerminalClipboardContribution.get(activeInstance)?.paste()
	});
}

if (BrowserFeatures.clipboard.readText && isLinux) {
	registerActiveInstanceAction({
		id: TerminalCommandId.PasteSelection,
		title: localize2('workbench.action.terminal.pasteSelection', 'Paste Selection into Active Terminal'),
		precondition: terminalAvailableWhenClause,
		keybinding: [{
			linux: { primary: KeyMod.Shift | KeyCode.Insert },
			weight: KeybindingWeight.WorkbenchContrib,
			when: TerminalContextKeys.focus
		}],
		run: (activeInstance) => TerminalClipboardContribution.get(activeInstance)?.pasteSelection()
	});
}

// #endregion
