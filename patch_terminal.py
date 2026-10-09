import os

path = 'src/vs/workbench/contrib/terminal/browser/terminalInstance.ts'
with open(path, 'r') as f:
    content = f.read()

old_code = """			const reader = new FileReader();
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
			reader.readAsDataURL(file);"""

new_code = """			if (file.size > 10 * 1024 * 1024) return;
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
						const escapedPath = `'${path.replace(/'/g, "'\\\\''")}'`;
						this.sendText(escapedPath, false);
					}
				} catch (err) {
					this._logService.error('Oyren paste image failed', err);
				}
			};
			reader.readAsDataURL(file);"""

content = content.replace(old_code, new_code)
with open(path, 'w') as f:
    f.write(content)
