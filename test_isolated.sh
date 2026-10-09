#!/usr/bin/env bash
set -e

echo "Running npm install..."
npm install

echo "Running server:init..."
npm run server:init

echo "Starting server on port 13131..."
./scripts/code-server.sh --port 13131 --without-connection-token &
SERVER_PID=$!

echo "Waiting for server to start..."
sleep 10

echo "Running Playwright..."
cat << 'PW' > test_paste_sandbox.mjs
import { chromium } from 'playwright-core';
import fs from 'fs';

(async () => {
  const browser = await chromium.launch({
    executablePath: '/ms-playwright/chromium-1232/chrome-linux64/chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--disable-dev-shm-usage']
  });
  
  const imgBuffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  
  console.log('Navigating to openvscode-server...');
  await page.goto('http://127.0.0.1:13131/?folder=/home/oyren/worktrees/IP-openvscode-server');
  
  console.log('Waiting for network idle...');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(5000);

  console.log('Toggling terminal...');
  await page.keyboard.press('Control+`');

  console.log('Waiting for xterm to be visible...');
  await page.waitForSelector('.xterm-helper-textarea', { state: 'attached', timeout: 15000 }).catch(() => {});
  
  console.log('Focusing xterm...');
  const xtermLocator = page.locator('.xterm-helper-textarea').first();
  if (await xtermLocator.count() > 0) {
    await xtermLocator.focus();
  }
  await page.waitForTimeout(2000);

  console.log('Pasting image...');
  await page.evaluate(async (imgBase64) => {
    const bstr = atob(imgBase64);
    const u8arr = new Uint8Array(bstr.length);
    for (let i = 0; i < bstr.length; i++) {
      u8arr[i] = bstr.charCodeAt(i);
    }
    const file = new File([u8arr], 'dummy.png', { type: 'image/png' });
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    const event = new ClipboardEvent('paste', {
      clipboardData: dataTransfer,
      bubbles: true,
      cancelable: true
    });
    const xterm = document.querySelector('.xterm');
    if (xterm) {
        xterm.dispatchEvent(event);
    } else {
        document.body.dispatchEvent(event);
    }
  }, imgBuffer.toString('base64'));

  await page.waitForTimeout(3000);

  console.log('Taking screenshot...');
  await page.screenshot({ path: 'isolated_paste_proof.png' });
  console.log('Saved isolated_paste_proof.png');
  
  await browser.close();
})();
PW
node test_paste_sandbox.mjs

echo "Killing server..."
kill $SERVER_PID
wait $SERVER_PID || true
echo "Done!"
