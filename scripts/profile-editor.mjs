import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { chromium, webkit } from 'playwright';
import { createServer } from 'vite';
import { installEditorProfile } from '../tests/editor-profile-runtime.mjs';

const output = process.argv[2];
if (!output) throw new Error('Usage: node scripts/profile-editor.mjs <new-output.json>');
const file = await fs.open(output, 'wx');
const short =
	'Community dance / 커뮤니티 댄스\n일시: 2026-12-19 19:00~22:00\n장소: Seoul Studio\nJoin us for music and dancing. 함께 춤춰요!';
const long =
	short +
	'\n' +
	Array.from(
		{ length: 80 },
		(_, i) =>
			`안내 ${i + 1}: 음악과 함께 즐거운 시간을 보내세요. Community guests are welcome; bring comfortable shoes.`
	).join('\n');
const result = {
	head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
	dirty: execFileSync('git', ['status', '--short'], { encoding: 'utf8' }).trim(),
	environment: {
		date: new Date().toISOString(),
		platform: os.platform(),
		release: os.release(),
		arch: os.arch(),
		cpu: os.cpus()[0].model,
		cores: os.cpus().length,
		memory: os.totalmem(),
		node: process.version
	},
	conditions: {
		server: 'Vite dev, dedicated loopback port 5174; no other task server',
		warmupJourneysPerSize: 2,
		samplesPerSize: 5,
		order: ['normal', 'disabled', 'enabled'],
		clock:
			'Date fixed; performance.now captured before clock installation; Node performance.now for wall',
		viewport: { width: 1280, height: 900 },
		inputs: {
			short: { utf16: short.length, utf8: Buffer.byteLength(short) },
			long: { utf16: long.length, utf8: Buffer.byteLength(long) }
		}
	},
	samples: [],
	calibration: [],
	sourceHashes: {},
	status: 'running'
};
for (const name of [
	'scripts/profile-editor.mjs',
	'scripts/editor-profile-plugin.mjs',
	'tests/editor-profile-runtime.mjs',
	'src/routes/+page.svelte',
	'src/lib/descriptionEditor.ts',
	'src/lib/core/EventCore.res',
	'src/lib/core/EventCore.res.js',
	'src/lib/core/TimeInput.res',
	'src/lib/core/TimeInput.res.js',
	'src/lib/core/Parser.res',
	'src/lib/core/Parser.res.js',
	'vite.config.ts',
	'rescript.json',
	'pnpm-lock.yaml'
]) {
	result.sourceHashes[name] = createHash('sha256')
		.update(await fs.readFile(name))
		.digest('hex');
}
result.environment.dependencies = {};
for (const name of [
	'vite',
	'svelte',
	'rescript',
	'playwright',
	'@js-temporal/polyfill',
	'compromise',
	'compromise-dates'
]) {
	result.environment.dependencies[name] = JSON.parse(
		await fs.readFile(`node_modules/${name}/package.json`, 'utf8')
	).version;
}
const save = () => file.writeFile(JSON.stringify(result));

async function frames(page) {
	await page.evaluate(
		() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
	);
}

async function journey(page, mode, size, text, repetition, warmup) {
	const stage = async (name, action) => {
		const before = await page.__cdp?.send('Performance.getMetrics');
		await page.evaluate(({ name, enabled }) => globalThis.__nlEventProfile.start(name, enabled), {
			name,
			enabled: mode === 'enabled'
		});
		const start = performance.now();
		await action();
		await frames(page);
		const wallMs = performance.now() - start;
		const { rows, dropped, inputEvents } = await page.evaluate(() =>
			globalThis.__nlEventProfile.stop()
		);
		const after = await page.__cdp?.send('Performance.getMetrics');
		const rendering = {};
		for (const metric of after?.metrics ?? []) {
			if (
				['LayoutCount', 'RecalcStyleCount', 'LayoutDuration', 'RecalcStyleDuration'].includes(
					metric.name
				)
			) {
				rendering[metric.name] =
					metric.value - before.metrics.find((item) => item.name === metric.name).value;
			}
		}
		assert.equal(dropped, 0);
		if (!warmup)
			result.samples.push({
				engine: page.__engine,
				mode,
				size,
				repetition,
				stage: name,
				wallMs,
				rendering,
				inputEvents,
				rows
			});
	};
	await stage('multiline-fill+settled-parse', async () => {
		await page.locator('#description').fill(text + '\n' + ' '.repeat(repetition + 1));
		await page.waitForFunction(
			() => !document.querySelector('#parse-status').textContent.includes('Parsing current')
		);
		assert.equal(
			await page.locator('#description').inputValue(),
			text + '\n' + ' '.repeat(repetition + 1)
		);
	});
	await stage('description-paste+settled-parse', async () => {
		await page.locator('#description').evaluate((node, value) => {
			node.value = value;
			node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }));
		}, text);
		await page.waitForFunction(
			() => !document.querySelector('#parse-status').textContent.includes('Parsing current')
		);
	});
	await stage('description-keypress+settled-parse', async () => {
		await page.locator('#description').focus();
		await page.locator('#description').press('ControlOrMeta+End');
		await page.keyboard.type(' ');
		await page.waitForFunction(
			() => !document.querySelector('#parse-status').textContent.includes('Parsing current')
		);
	});
	await stage('settled-idle', () => frames(page));
	await stage('manual-title', () => page.locator('#title').fill('Manual community event'));
	await stage('manual-canonical-start', () => page.locator('#start').fill('2026-12-19 18:00'));
	await stage('manual-freeform-start', () =>
		page.locator('#start').fill('December 19 2026 at 6pm')
	);
	await stage('evidence-hover', async () => {
		const chip = page.locator('#start-time-options button.source-backed').first();
		await chip.hover();
		assert.ok(await page.locator('.description-evidence mark[data-hovered="true"]').count());
	});
	await page.mouse.move(0, 0);
	await stage('evidence-focus', async () => {
		await page.locator('#description').focus();
		await page.keyboard.press('Tab');
		// Programmatic focus after a keyboard event retains keyboard focus-visible semantics.
		await page.locator('#start-time-options button.source-backed').first().focus();
		assert.ok(await page.locator('.description-evidence mark[data-hovered="true"]').count());
	});
	await page.locator('#description').focus();
	await stage('editor-scroll', async () => {
		await page.locator('#description').evaluate((node) => {
			node.scrollTop = node.scrollHeight;
			node.dispatchEvent(new Event('scroll'));
		});
	});
	await stage('viewport-resize', () => page.setViewportSize({ width: 1100, height: 800 }));
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.getByRole('button', { name: 'Reset', exact: true }).click();
	await frames(page);
}

try {
	for (const mode of result.conditions.order) {
		if (mode === 'normal') delete process.env.NL_EVENT_EDITOR_PROFILE;
		else process.env.NL_EVENT_EDITOR_PROFILE = '1';
		const server = await createServer({
			server: { port: 5174, strictPort: true, host: '127.0.0.1' }
		});
		await server.listen();
		try {
			for (const [engine, launcher] of Object.entries({ chromium, webkit })) {
				const browser = await launcher.launch();
				try {
					const context = await browser.newContext({
						viewport: result.conditions.viewport,
						timezoneId: 'Asia/Seoul'
					});
					const page = await context.newPage();
					page.__engine = engine;
					const errors = [];
					page.on('pageerror', (error) => errors.push(error.message));
					await page.addInitScript(installEditorProfile);
					await page.clock.setFixedTime(new Date('2026-10-24T03:00:00Z'));
					await page.goto('http://127.0.0.1:5174/');
					await page.waitForFunction(() => !document.querySelector('#description')?.disabled);
					await page.evaluate(() => document.fonts.ready);
					if (engine === 'chromium') {
						page.__cdp = await context.newCDPSession(page);
						await page.__cdp.send('Performance.enable');
					}
					if (mode === 'enabled') {
						result.calibration.push({
							engine,
							runs: await page.evaluate(() => {
								const runs = [];
								for (let repetition = 0; repetition < 3; repetition++) {
									for (const kind of ['plain', 'disabled', 'enabled']) {
										globalThis.__nlEventProfile.start('calibration', kind === 'enabled');
										const start = globalThis.__nlEventProfile.now();
										for (let i = 0; i < 10000; i++) {
											if (kind === 'plain') (() => 1)();
											else globalThis.__nlEventProfile.measure('empty', () => 1);
										}
										const wallMs = globalThis.__nlEventProfile.now() - start;
										const { rows, dropped } = globalThis.__nlEventProfile.stop();
										runs.push({
											kind,
											repetition,
											iterations: 10000,
											wallMs,
											spans: rows.length,
											dropped
										});
									}
								}
								return runs;
							})
						});
					}
					for (const [size, text] of Object.entries({ short, long })) {
						for (let i = 0; i < 7; i++) await journey(page, mode, size, text, i, i < 2);
					}
					assert.deepEqual(errors, []);
					result.environment[engine] = browser.version();
					console.log(`${mode}/${engine}: short and long journeys passed`);
				} finally {
					await browser.close();
				}
			}
		} finally {
			await server.close();
		}
	}
	result.status = 'passed';
} catch (error) {
	result.status = 'failed';
	result.error = error.stack;
	process.exitCode = 1;
} finally {
	await save();
	await file.close();
	console.log(`Editor profile ${result.status}: ${output}`);
}
