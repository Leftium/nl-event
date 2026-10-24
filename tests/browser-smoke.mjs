import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

for (const [name, engine] of [
	['chromium', chromium],
	['webkit', webkit]
]) {
	const browser = await engine.launch();
	const context = await browser.newContext({
		timezoneId: 'Asia/Seoul',
		acceptDownloads: true,
		viewport: { width: 1280, height: 900 }
	});
	const page = await context.newPage();
	const errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await page.goto(process.env.NL_EVENT_BASE_URL || 'http://localhost:5173/');
	await page.locator('#description').waitFor();
	await page.waitForFunction(() => !document.querySelector('#description').disabled);
	assert.deepEqual(
		await page.locator('textarea, input[type=text]').evaluateAll((nodes) => nodes.map((n) => n.id)),
		['description', 'title', 'start', 'end', 'location']
	);
	assert.equal(
		await page.getByRole('button', { name: 'Download .ics', exact: true }).isDisabled(),
		true
	);
	await page.locator('#description').fill('Original 한글🙂\nDescription; comma, slash\\');
	await page.locator('#title').fill('Manual title');
	await page.locator('#start').fill('2026-10-25 17:00');
	await page.locator('#end').fill('2026-10-25 18:00');
	const google = page.getByRole('link', { name: 'Open in Google Calendar' });
	await google.waitFor();
	const params = new URL(await google.getAttribute('href')).searchParams;
	assert.equal(params.get('details'), await page.locator('#description').inputValue());
	assert.equal(params.get('dates'), '20261025T080000Z/20261025T090000Z');
	const download = async () => {
		const pending = page.waitForEvent('download');
		await page.getByRole('button', { name: 'Download .ics', exact: true }).click();
		const item = await pending;
		return fs.readFile(await item.path(), 'utf8');
	};
	const first = await download();
	const uid = (text) => text.match(/UID:(.*)\r\n/)[1];
	assert.ok(first.includes('DESCRIPTION:Original 한글🙂\\nDescription\\; comma\\, slash\\\\'));
	await page.locator('#title').fill('Edited title');
	assert.equal(uid(await download()), uid(first));
	await page.getByRole('button', { name: 'Reset Title to suggested', exact: true }).click();
	assert.equal(await page.locator('#title').inputValue(), '');
	assert.equal(uid(await download()), uid(first));
	await page.locator('#description').fill('');
	assert.equal(await page.locator('#start').inputValue(), '2026-10-25 17:00');
	page.once('dialog', (dialog) => dialog.dismiss());
	await page.getByRole('button', { name: 'New event', exact: true }).click();
	assert.equal(await page.locator('#start').inputValue(), '2026-10-25 17:00');
	// Stub browser permission/read outcomes; never reads the developer's real clipboard.
	const clipboard = async (value) =>
		page.evaluate(
			(value) =>
				Object.defineProperty(navigator, 'clipboard', {
					configurable: true,
					value: {
						readText: async () => {
							if (value === null) throw new Error('denied');
							return value;
						}
					}
				}),
			value
		);
	await clipboard(null);
	await page.getByRole('button', { name: 'Paste from clipboard', exact: true }).click();
	await page.getByRole('status').filter({ hasText: 'could not be read' }).waitFor();
	assert.equal(await page.locator('#start').inputValue(), '2026-10-25 17:00');
	await clipboard('');
	await page.getByRole('button', { name: 'Paste from clipboard', exact: true }).click();
	await page.getByRole('status').filter({ hasText: 'empty' }).waitFor();
	assert.equal(await page.locator('#start').inputValue(), '2026-10-25 17:00');
	await clipboard('replacement text');
	page.once('dialog', (dialog) => dialog.dismiss());
	await page.getByRole('button', { name: 'Paste from clipboard', exact: true }).click();
	assert.equal(await page.locator('#start').inputValue(), '2026-10-25 17:00');
	page.once('dialog', (dialog) => dialog.accept());
	await page.getByRole('button', { name: 'Paste from clipboard', exact: true }).click();
	assert.equal(await page.locator('#description').inputValue(), 'replacement text');
	assert.equal(await page.locator('#start').inputValue(), '');
	await page.locator('#start').fill('2026-10-25');
	await page.locator('#end').fill('2026-10-26');
	assert.notEqual(uid(await download()), uid(first));
	assert.equal(
		new URL(await google.getAttribute('href')).searchParams.get('dates'),
		'20261025/20261027'
	);
	await page.getByRole('button', { name: 'Change time zone', exact: true }).click();
	await page.locator('#zone').fill('America/Chicago');
	await page.locator('#start').fill('2026-11-01 01:30');
	await page.locator('#end').fill('2026-11-01 02:30');
	assert.equal(
		await page.getByRole('button', { name: 'Download .ics', exact: true }).isDisabled(),
		true
	);
	await page.getByRole('radio', { name: 'Earlier (UTC-05:00)', exact: true }).check();
	assert.equal(
		new URL(await google.getAttribute('href')).searchParams.get('dates'),
		'20261101T063000Z/20261101T083000Z'
	);
	await page.getByRole('radio', { name: 'Later (UTC-06:00)', exact: true }).check();
	assert.equal(
		new URL(await google.getAttribute('href')).searchParams.get('dates'),
		'20261101T073000Z/20261101T083000Z'
	);
	await page.locator('#start').fill('2026-03-08 02:30');
	await page.locator('#end').fill('2026-03-08 04:00');
	assert.equal(
		await page.getByRole('button', { name: 'Download .ics', exact: true }).isDisabled(),
		true
	);
	assert.match(await page.locator('#start-error').textContent(), /DST gap/);
	await page.setViewportSize({ width: 390, height: 844 });
	assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
	await page.screenshot({
		path: path.join(os.tmpdir(), `nl-event-${name}-mobile.png`),
		fullPage: true
	});
	page.once('dialog', (dialog) => dialog.accept());
	await page.getByRole('button', { name: 'New event', exact: true }).click();
	assert.equal(await page.locator('#description').inputValue(), '');
	assert.equal(await page.locator('#zone').count(), 0);
	assert.equal(
		await page.locator('#description').evaluate((node) => node === document.activeElement),
		true
	);
	assert.deepEqual(errors, []);
	console.log(
		`${name}: PASS - hydration, five fields, Google query, real ICS downloads, UID reuse/reset, ownership/reset, confirmation cancellation, clipboard failure/empty/cancel/replace, all-day bounds, zone/DST choices/gaps, 390px layout, focus; no page errors`
	);
	await browser.close();
}
