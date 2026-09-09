#!/usr/bin/env node
// Manual, local-only verification for --persist-exthost (oyren-ai/openvscode-server#12).
// Not wired into CI or test/smoke — see the PR's checklist / handoff plan for why. Requires
// `npm run compile` to have produced out/server-main.js first (scripts/code-server.sh runs
// straight out of `out/`).
//
// Usage:
//   node oyren/scripts/verify-persist-exthost.mjs                   # expect PASS on both scenarios
//   VERIFY_CONTROL=1 node oyren/scripts/verify-persist-exthost.mjs  # flag OMITTED — expect the OPPOSITE
//   VERIFY_FULL_WAIT=1 node oyren/scripts/verify-persist-exthost.mjs  # + real ~5.5min timer on scenario 2
//
// Run the CONTROL pass at least once — that's what proves these assertions are wired to the
// real code path (RemoteAgentConnection / RemoteExtensionHostAgentServer), not vacuously green.
// Scenario 2 waits up to 45s for the server's own heartbeat-based dead-peer detection to kick in
// before opening the second tab, so a full run (both scenarios, in parallel) takes ~50-60s.

import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONTROL = process.env.VERIFY_CONTROL === '1';
const FULL_WAIT = process.env.VERIFY_FULL_WAIT === '1';

const PAYLOAD = encodeURIComponent(`[${['["skipWelcome","true"]', '["skipReleaseNotes","true"]'].join(',')}]`);
const SHORTEN_5M = /Another client has connected, will shorten the wait for reconnection 5m before disposing\.\.\./;
const DISCONNECTED_WAITING = /The client has disconnected, will wait for reconnection/;
const LAUNCHED_PID = /<(\d+)>\s+Launched Extension Host Process\./;
const exitLineFor = (pid) => new RegExp(`<${pid}>\\s+Extension Host Process exited with code`);
const since = (log, t0) => log.filter((e) => e.t >= t0).map((e) => e.s).join('');

async function waitForLog(log, t0, pattern, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (pattern.test(since(log, t0))) {
			return true;
		}
		await delay(1000);
	}
	return pattern.test(since(log, t0));
}

let nextPort = 9231;

function startServer(label) {
	const port = nextPort++;
	const dataDir = path.join(os.tmpdir(), `persist-exthost-verify-${label}-${port}`);
	fs.mkdirSync(dataDir, { recursive: true });
	const args = [
		'--disable-telemetry',
		'--disable-workspace-trust',
		`--port=${port}`,
		'--accept-server-license-terms',
		`--server-data-dir=${dataDir}`,
	];
	if (!CONTROL) {
		args.push('--persist-exthost');
	}
	const script = path.join(ROOT, 'scripts', process.platform === 'win32' ? 'code-server.bat' : 'code-server.sh');

	const log = [];
	let resolveEndpoint;
	const endpointPromise = new Promise((r) => { resolveEndpoint = r; });
	const proc = spawn(script, args, { env: process.env, shell: process.platform === 'win32', detached: process.platform !== 'win32' });
	const onData = (buf) => {
		const s = buf.toString();
		log.push({ t: Date.now(), s });
		const m = s.match(/Web UI available at (.+)/);
		if (m && resolveEndpoint) {
			resolveEndpoint(m[1].trim());
			resolveEndpoint = null;
		}
	};
	proc.stdout.on('data', onData);
	proc.stderr.on('data', onData);
	return { proc, log, endpointPromise };
}

function stopServer(proc) {
	try {
		if (process.platform === 'win32') {
			proc.kill();
		} else {
			process.kill(-proc.pid, 'SIGTERM'); // kill the whole process group (bash + spawned node)
		}
	} catch {
		// already gone
	}
}

async function openPage(browser, endpoint) {
	const context = await browser.newContext();
	const page = await context.newPage();
	await page.goto(`${endpoint}&payload=${PAYLOAD}`);
	await page.waitForLoadState('load');
	return { context, page };
}

async function scenario1_turnSurvivesClosedTab() {
	const { proc, log, endpointPromise } = startServer('s1');
	let browser;
	try {
		const endpoint = await endpointPromise;
		browser = await chromium.launch({ headless: true });
		const { context, page } = await openPage(browser, endpoint);
		await delay(3000); // let the management + ext-host connections fully establish

		const launched = since(log, 0).match(LAUNCHED_PID);
		if (!launched) {
			console.log('[scenario1] FAIL: never saw "Launched Extension Host Process."');
			return false;
		}
		const pid = launched[1];

		const t0 = Date.now();
		// page.close()/context.close() runs the page's real unload lifecycle (confirmed empirically:
		// in stock/CONTROL mode this sends an explicit app-level Disconnect and the host dies within
		// ~2s). --persist-exthost suppresses that outgoing Disconnect client-side, so the server never
		// sees the graceful goodbye; the ext host then simply isn't torn down (confirmed: still alive
		// 30s+ later, see waitForLog(DISCONNECTED_WAITING) below, which is the server's PRE-EXISTING,
		// unrelated heartbeat-based dead-peer detection picking up the raw socket loss ~30s in).
		await page.close();
		await context.close();
		await delay(8000); // generous headroom over the ~2s CONTROL kill time

		const diedQuickly = exitLineFor(pid).test(since(log, t0));
		const pass = CONTROL ? diedQuickly : !diedQuickly;
		console.log(`[scenario1] pid=${pid} diedQuickly=${diedQuickly} -> ${pass ? 'PASS' : 'FAIL'} (CONTROL=${CONTROL})`);
		return pass;
	} finally {
		if (browser) {
			await browser.close();
		}
		stopServer(proc);
	}
}

async function scenario2_secondTabNo5MinKill() {
	// The "shorten to 5m" sweep only ever touches a connection that's already sitting in the
	// disconnected/waiting-for-reconnection state (see shortenReconnectionGraceTimeIfNecessary()
	// in remoteExtensionManagement.ts). A graceful tab close (page.close()) sends an explicit
	// Disconnect and gets disposed INSTANTLY in stock mode -- it never reaches that waiting state,
	// so a plain close can't exercise this path in CONTROL, and context.setOffline() was tried and
	// doesn't sever an already-established WebSocket either. Simulate a real abrupt disconnect (lid
	// closed, network dropped) instead: launch tab A via chromium.launchServer() so its real OS
	// process can be SIGKILLed directly -- no JS ever runs, no goodbye is ever sent, in EITHER mode
	// -- then wait for the server's own (pre-existing, unrelated to persist-exthost) heartbeat-based
	// dead-peer detection to mark it "disconnected, will wait for reconnection" before opening tab B.
	const { proc, log, endpointPromise } = startServer('s2');
	let serverA, browserB;
	try {
		const endpoint = await endpointPromise;

		serverA = await chromium.launchServer({ headless: true });
		const browserA = await chromium.connect(serverA.wsEndpoint());
		const a = await openPage(browserA, endpoint);
		await delay(3000);
		const launchedA = since(log, 0).match(LAUNCHED_PID);
		const pidA = launchedA ? launchedA[1] : null;

		const disconnectT0 = Date.now();
		const osProcess = serverA.process();
		osProcess.kill('SIGKILL');
		serverA = null; // already dead, don't try to close() it gracefully in finally

		const reachedWaitingState = await waitForLog(log, disconnectT0, DISCONNECTED_WAITING, 60000);
		if (!reachedWaitingState) {
			console.log('[scenario2] FAIL: server never logged "disconnected, will wait for reconnection" for tab A within 60s');
			return false;
		}

		const t0 = Date.now();
		browserB = await chromium.launch({ headless: true });
		const b = await openPage(browserB, endpoint);
		await delay(3000); // give the server's new-connection loop time to run + log

		const shortened = SHORTEN_5M.test(since(log, t0));

		let survivedFullWait = null;
		if (FULL_WAIT && pidA) {
			await delay(5.5 * 60 * 1000);
			survivedFullWait = !exitLineFor(pidA).test(since(log, t0));
		}

		await b.page.close();
		await b.context.close();

		const pass = CONTROL ? shortened : (!shortened && survivedFullWait !== false);
		console.log(`[scenario2] pidA=${pidA} shortened5m=${shortened} survivedFullWait=${survivedFullWait} -> ${pass ? 'PASS' : 'FAIL'} (CONTROL=${CONTROL})`);
		return pass;
	} finally {
		if (serverA) {
			await serverA.close();
		}
		if (browserB) {
			await browserB.close();
		}
		stopServer(proc);
	}
}

const results = await Promise.all([scenario1_turnSurvivesClosedTab(), scenario2_secondTabNo5MinKill()]);
process.exit(results.every(Boolean) ? 0 : 1);
