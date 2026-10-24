import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

async function checkPendingClipboard(page) {
	await page.evaluate(() => {
		window.clipboardReads = [];
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: {
				readText: () =>
					new Promise((resolve, reject) => {
						window.clipboardReads.push({ resolve, reject });
					})
			}
		});
	});
	const paste = page.getByRole('button', { name: 'Paste from clipboard', exact: true });
	const newEvent = page.getByRole('button', { name: 'New event', exact: true });
	const complete = (index, text, reject = false) =>
		page.evaluate(
			async ({ index, text, reject }) => {
				const read = window.clipboardReads[index];
				if (reject) read.reject(new Error('denied'));
				else read.resolve(text);
				// Drain the async handler and Svelte's render before assertions.
				await new Promise((resolve) => setTimeout(resolve, 0));
			},
			{ index, text, reject }
		);

	// A discarded draft must ignore success, empty text, and rejection alike.
	for (const [index, text, reject] of [
		[0, 'stale text', false],
		[1, '', false],
		[2, '', true]
	]) {
		await page.locator('#description').fill('Discard this draft');
		await paste.click();
		await page.getByRole('button', { name: 'Reading clipboard...', exact: true }).waitFor();
		page.once('dialog', (dialog) => dialog.accept());
		await newEvent.click();
		await complete(index, text, reject);
		assert.deepEqual(
			await page
				.locator('textarea, input[type=text]')
				.evaluateAll((nodes) => nodes.map((n) => n.value)),
			['', '', '', '', '']
		);
		assert.equal(await page.getByRole('status').textContent(), '');
		assert.equal(await paste.isEnabled(), true);
	}

	// Cancelling New event keeps the outstanding operation valid.
	await page.locator('#description').fill('Keep this draft');
	await paste.click();
	page.once('dialog', (dialog) => dialog.dismiss());
	await newEvent.click();
	assert.equal(
		await page.getByRole('button', { name: 'Reading clipboard...', exact: true }).isDisabled(),
		true
	);
	page.once('dialog', (dialog) => dialog.accept());
	await complete(3, 'Valid clipboard text');
	assert.equal(await page.locator('#description').inputValue(), 'Valid clipboard text');
	assert.match(await page.getByRole('status').textContent(), /Clipboard text added/);

	// A stale completion must not clear a newer read's busy state or message.
	await paste.click();
	page.once('dialog', (dialog) => dialog.accept());
	await newEvent.click();
	await paste.click();
	await complete(4, '', true);
	assert.equal(
		await page.getByRole('button', { name: 'Reading clipboard...', exact: true }).isDisabled(),
		true
	);
	assert.equal(await page.getByRole('status').textContent(), '');
	await complete(5, 'Current clipboard text');
	assert.equal(await page.locator('#description').inputValue(), 'Current clipboard text');
	assert.equal(await paste.isEnabled(), true);
	page.once('dialog', (dialog) => dialog.accept());
	await newEvent.click();
}

async function checkCandidates(page) {
	const settled = () =>
		page.waitForFunction(
			() => !document.querySelector('#parse-status').textContent.includes('Parsing current')
		);
	const reset = async () => {
		const accept = (dialog) => dialog.accept();
		page.once('dialog', accept);
		await page.getByRole('button', { name: 'New event', exact: true }).click();
		page.off('dialog', accept);
	};
	await page.clock.install({ time: new Date('2026-10-24T03:00:00Z') });
	// All 14 source inputs are also exercised through the actual UI. Only context
	// enters the draft; expectation assertions are evaluated by the driver afterward.
	for (const file of await fs.readdir('tests/fixtures/nl-event/expected')) {
		const fixture = JSON.parse(
			await fs.readFile(`tests/fixtures/nl-event/expected/${file}`, 'utf8')
		);
		await page.clock.setFixedTime(new Date(fixture.context.referenceInstant));
		await reset();
		const text = await fs.readFile(`tests/fixtures/nl-event/inputs/${fixture.id}.txt`, 'utf8');
		await page.locator('#description').fill(text);
		await settled();
		for (const [field, expected] of Object.entries(fixture.assertions.preferred ?? {})) {
			if (field.endsWith('Contains'))
				assert.ok(
					(await page.locator(`#${field.replace('Contains', '')}`).inputValue()).includes(expected)
				);
			else assert.equal(await page.locator(`#${field}`).inputValue(), expected ?? '');
		}
		assert.equal(await page.locator('#description').inputValue(), text);
		if (
			fixture.assertions.exportable === false ||
			fixture.assertions.exportableBeforeChoice === false
		)
			assert.equal(
				await page.getByRole('button', { name: 'Download .ics', exact: true }).isDisabled(),
				true
			);
	}
	await reset();
	await page
		.locator('#description')
		.fill(
			await fs.readFile('tests/fixtures/nl-event/inputs/k3-slow-saturday-synthetic.txt', 'utf8')
		);
	await settled();
	const end = await page.locator('#end').inputValue();
	const alternative = page
		.getByRole('list', { name: 'Start alternatives', exact: true })
		.getByRole('button', { name: '2026-07-11 16:30', exact: true });
	await alternative.click();
	assert.equal(await page.locator('#start').inputValue(), '2026-07-11 16:30');
	assert.equal(await page.locator('#end').inputValue(), end);
	await page
		.getByRole('list', { name: 'End alternatives', exact: true })
		.getByRole('button', { name: '2026-07-11 18:00', exact: true })
		.click();
	await page.getByRole('button', { name: 'Reset End to suggested', exact: true }).click();
	assert.equal(await page.locator('#end').inputValue(), '2026-07-11 18:00');
	const selectedGoogle = new URL(
		await page.getByRole('link', { name: 'Open in Google Calendar' }).getAttribute('href')
	);
	assert.equal(selectedGoogle.searchParams.get('dates'), '20260711T073000Z/20260711T090000Z');
	const download = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Download .ics', exact: true }).click();
	const selectedIcs = await fs.readFile(await (await download).path(), 'utf8');
	assert.ok(selectedIcs.includes('DTSTART:20260711T073000Z\r\nDTEND:20260711T090000Z'));
	await page.setViewportSize({ width: 390, height: 844 });
	assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
	await page.screenshot({
		path: path.join(
			os.tmpdir(),
			`nl-event-candidates-${page.context().browser().browserType().name()}.png`
		),
		fullPage: true
	});
	await page.setViewportSize({ width: 1280, height: 900 });

	// Typing during debounce wins; clearing invalidates evidence and retains Manual.
	await page.locator('#description').fill('Title: Replacement\nTomorrow at 7pm');
	await page.locator('#title').fill('My title');
	assert.equal(
		await page.getByRole('list', { name: 'Start alternatives', exact: true }).count(),
		0
	);
	await settled();
	assert.equal(await page.locator('#title').inputValue(), 'My title');
	await page.locator('#description').fill('');
	assert.equal(await page.locator('#start').inputValue(), '2026-07-11 16:30');
	assert.equal(await page.locator('#end').inputValue(), '');
	assert.equal(
		await page.getByRole('list', { name: 'Start alternatives', exact: true }).count(),
		0
	);
	await reset();
	await page.locator('#description').fill('Class 1: Example: 12:15 - 1:15 pm');
	await settled();
	await page
		.getByRole('list', { name: 'Start alternatives', exact: true })
		.getByRole('button', { name: '12:15', exact: true })
		.click();
	assert.equal(await page.locator('#start').inputValue(), '12:15');
	assert.equal(
		await page.getByRole('button', { name: 'Download .ics', exact: true }).isDisabled(),
		true
	);
	await page.locator('#start').fill('2026-05-16');
	await page
		.getByRole('list', { name: 'Start alternatives', exact: true })
		.getByRole('button', { name: '12:15', exact: true })
		.click();
	assert.equal(await page.locator('#start').inputValue(), '2026-05-16 12:15');
	await page.locator('#end').fill('2026-05-16 13:15');
	await page.getByRole('link', { name: 'Open in Google Calendar' }).waitFor();
	await reset();
	// Pending work from a discarded draft cannot repopulate the replacement.
	await page.locator('#description').fill('Tomorrow at 7pm');
	await reset();
	await page.waitForTimeout(350);
	assert.deepEqual(
		await page
			.locator('textarea, input[type=text]')
			.evaluateAll((nodes) => nodes.map((n) => n.value)),
		['', '', '', '', '']
	);
}

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
	await checkPendingClipboard(page);
	await checkCandidates(page);
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
	assert.equal(await page.locator('#title').inputValue(), 'Original 한글🙂');
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
	// Compact actions remain keyboard accessible with Nimble's visible focus treatment.
	await page.locator('#start').focus();
	// WebKit on macOS uses Option+Tab to include buttons in keyboard navigation.
	await page.keyboard.press(name === 'webkit' ? 'Alt+Shift+Tab' : 'Shift+Tab');
	const resetStart = page.getByRole('button', { name: 'Reset Start to suggested', exact: true });
	assert.equal(await resetStart.evaluate((node) => node === document.activeElement), true);
	assert.notEqual(await resetStart.evaluate((node) => getComputedStyle(node).boxShadow), 'none');
	await page.keyboard.press('Space');
	assert.equal(await page.locator('#start').inputValue(), '');
	await page.locator('#start').fill('2026-11-01 01:30');
	await page.getByRole('radio', { name: 'Later (UTC-06:00)', exact: true }).check();
	for (const [layout, width, height] of [
		['desktop', 1280, 900],
		['mobile', 390, 844]
	]) {
		await page.setViewportSize({ width, height });
		assert.equal(
			await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
			true
		);
		await page.screenshot({
			path: path.join(os.tmpdir(), `nl-event-${name}-${layout}.png`),
			fullPage: true
		});
	}
	await page.locator('#start').fill('2026-03-08 02:30');
	await page.locator('#end').fill('2026-03-08 04:00');
	assert.equal(
		await page.getByRole('button', { name: 'Download .ics', exact: true }).isDisabled(),
		true
	);
	assert.match(await page.locator('#start-error').textContent(), /DST gap/);
	await page.setViewportSize({ width: 390, height: 844 });
	assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
	page.once('dialog', (dialog) => dialog.accept());
	await page.getByRole('button', { name: 'New event', exact: true }).click();
	assert.equal(await page.locator('#description').inputValue(), '');
	assert.equal(await page.locator('#zone').count(), 0);
	assert.equal(
		await page.locator('#description').evaluate((node) => node === document.activeElement),
		true
	);
	const touchContext = await browser.newContext({
		timezoneId: 'Asia/Seoul',
		hasTouch: true,
		viewport: { width: 390, height: 844 }
	});
	const touchPage = await touchContext.newPage();
	touchPage.on('pageerror', (error) => errors.push(error.message));
	await touchPage.goto(process.env.NL_EVENT_BASE_URL || 'http://localhost:5173/');
	await touchPage.waitForFunction(() => !document.querySelector('#description').disabled);
	await touchPage.locator('#title').fill('Touch target check');
	await touchPage.locator('#start').fill('2026-10-25 17:00');
	await touchPage.locator('#end').fill('2026-10-25 18:00');
	await touchPage.getByRole('button', { name: 'Change time zone', exact: true }).tap();
	assert.equal(await touchPage.evaluate(() => matchMedia('(any-pointer: coarse)').matches), true);
	assert.equal(
		await touchPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
		true
	);
	assert.ok(
		await touchPage
			.locator('button.inline')
			.evaluateAll((nodes) => nodes.every((node) => node.getBoundingClientRect().height >= 44))
	);
	await touchPage.getByRole('button', { name: 'Reset Title to suggested', exact: true }).tap();
	assert.equal(await touchPage.locator('#title').inputValue(), '');
	await touchPage.screenshot({
		path: path.join(os.tmpdir(), `nl-event-${name}-touch.png`),
		fullPage: true
	});
	await touchContext.close();
	assert.deepEqual(errors, []);
	console.log(
		`${name}: PASS - hydration, five fields, Google query, real ICS downloads, UID reuse/reset, 14 parsing fixtures, per-field candidates, partial resolution, debounce/new-draft invalidation, ownership/reset, confirmation cancellation, clipboard failure/empty/cancel/replace and pending-read races, all-day bounds, zone/DST choices/gaps, desktop/390px layout, compact inline actions, keyboard focus/activation, coarse-pointer touch targets; no page errors`
	);
	await browser.close();
}
