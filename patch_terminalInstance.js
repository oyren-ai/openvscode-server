const fs = require('fs');

const path = 'src/vs/workbench/contrib/terminal/browser/terminalInstance.ts';
let content = fs.readFileSync(path, 'utf8');

const oldCode = `			const reader = new FileReader();
			reader.onload = async () => {
				const dataUrl = reader.result as string;
				const base64 = dataUrl.split(',')[1];
				try {
					await this._commandService.executeCommand('oyren.terminal.pasteImage', {
						base64,
						mime: file.type
					});
				} catch (err) {
					this._logService.error('Oyren paste image failed', err);
				}
			};
			reader.readAsDataURL(file);`;

const newCode = `			// Check size limit before reading (10MB)
			if (file.size > 10 * 1024 * 1024) {
				return;
			}
			const reader = new FileReader();
			reader.onload = async () => {
				const dataUrl = reader.result as string;
				const base64 = dataUrl.split(',')[1];
				try {
					const path = await this._commandService.executeCommand<string | undefined>('oyren.terminal.pasteImage', {
						base64,
						mime: file.type
					});
					if (path) {
					    const escapedPath = \`'\${path.replace(/'/g, "'\\\\''")}'\`;
					    this.sendText(escapedPath, false);
					}
				} catch (err) {
					this._logService.error('Oyren paste image failed', err);
				}
			};
			reader.readAsDataURL(file);`;

content = content.replace(oldCode, newCode);
fs.writeFileSync(path, content);
