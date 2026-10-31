import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { chromium, webkit } from 'playwright';

export async function checkSpacedClock(page, touch = false) {
	const source = await fs.readFile(
		new URL('./inputs/spaced-clock-overnight-sanitized.txt', import.meta.url),
		'utf8'
	);
	const activate = (node) => (touch ? node.tap() : node.click());
	const reset = () => activate(page.getByRole('button', { name: 'Reset', exact: true }));
	const description = page.locator('#description');
	const trim = page.getByRole('checkbox', { name: 'Include actual end time', exact: true });
	const google = page.getByRole('link', { name: 'Open in Google Calendar', exact: true });
	const query = async () => new URL(await google.getAttribute('href')).searchParams;
	const download = async () => {
		const [file] = await Promise.all([
			page.waitForEvent('download'),
			activate(page.getByRole('button', { name: 'Download .ics', exact: true }))
		]);
		return (await fs.readFile(await file.path(), 'utf8')).replace(/\r\n /g, '');
	};
	await page.clock.setFixedTime(new Date('2026-10-24T03:00:00Z'));
	await reset();
	try {
		await description.fill(source);
		await page.waitForFunction(() =>
			document.querySelector('#end-hint').textContent.includes('2026-12-20 03:00')
		);
		assert.equal(await page.locator('#title').inputValue(), 'Example Blues Party');
		assert.match(await page.locator('#start-hint').textContent(), /2026-12-19 23:00/);
		assert.equal(
			(await page.locator('#end-hint').textContent()).includes('inferred 60 min'),
			false
		);
		assert.match(await page.locator('#start').inputValue(), /23: 00/);
		assert.match(await page.locator('.duration-summary').textContent(), /\b4h\b/);
		for (const label of ['Start', 'End/Duration'])
			assert.equal(
				await page.getByRole('switch', { name: `Auto ${label}`, exact: true }).isChecked(),
				true
			);
		assert.equal(await description.inputValue(), source);
		assert.ok(
			(await page.locator('.description-evidence mark').allTextContents()).some((text) =>
				text.includes('23: 00')
			)
		);
		assert.equal(await trim.isChecked(), false);
		assert.equal((await query()).get('dates'), '20261219T140000Z/20261219T140000Z');
		assert.match((await query()).get('details'), /Actual end: Dec 20, 2026, 03:00/);
		assert.ok(!(await download()).includes('DTEND:'));
		await activate(trim);
		assert.equal(await trim.isChecked(), true);
		assert.equal((await query()).get('dates'), '20261219T140000Z/20261219T180000Z');
		assert.equal((await query()).get('details'), source);
		const ics = await download();
		assert.ok(ics.includes('DTSTART:20261219T140000Z\r\nDTEND:20261219T180000Z\r\n'));
		assert.equal(ics.includes('Actual end:'), false);
		assert.equal(await description.inputValue(), source);
		await page.locator('#start').fill('2026-12-19 22:00');
		await description.fill(source.replace('23: 00', '23 : 00'));
		await page.waitForFunction(
			() => !document.querySelector('#parse-status').textContent.includes('Parsing current')
		);
		assert.equal(await page.locator('#start').inputValue(), '2026-12-19 22:00');
		await activate(page.getByRole('switch', { name: 'Auto Start', exact: true }));
		assert.match(await page.locator('#start-hint').textContent(), /2026-12-19 23:00/);
		assert.match(await page.locator('#start').inputValue(), /23 : 00/);
		assert.equal((await query()).get('dates'), '20261219T140000Z/20261219T180000Z');
	} finally {
		await reset();
	}
}

async function run() {
	for (const [name, engine] of [
		['chromium', chromium],
		['webkit', webkit]
	]) {
		const browser = await engine.launch();
		try {
			for (const touch of [false, true]) {
				const context = await browser.newContext({
					timezoneId: 'Asia/Seoul',
					acceptDownloads: true,
					hasTouch: touch,
					viewport: touch ? { width: 390, height: 844 } : { width: 1280, height: 900 }
				});
				try {
					const page = await context.newPage();
					const errors = [];
					page.on('pageerror', (error) => errors.push(error.message));
					await page.goto(process.env.NL_EVENT_BASE_URL || 'http://localhost:5173/');
					await page.waitForFunction(() => !document.querySelector('#description')?.disabled);
					await checkSpacedClock(page, touch);
					assert.deepEqual(errors, []);
					console.log(
						`${name} ${touch ? 'touch' : 'desktop'}: PASS - spaced overnight range, Auto fields, duration, source evidence, trim/full Google and ICS, manual edit/reset`
					);
				} finally {
					await context.close();
				}
			}
		} finally {
			await browser.close();
		}
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	run().catch((error) => {
		console.error(error);
		process.exitCode = 1;
	});
}
