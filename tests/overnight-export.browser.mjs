import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

export async function checkOvernightExport(page, touch = false) {
	const activate = (node) => (touch ? node.tap() : node.click());
	const reset = () => activate(page.getByRole('button', { name: 'Reset', exact: true }));
	const toggle = page.getByRole('checkbox', { name: 'Trim overnight tail' });
	const endField = page.getByRole('group', { name: 'End/Duration', exact: true });
	const preview = endField.locator('.calendar-end');
	const google = page.getByRole('link', { name: 'Open in Google Calendar', exact: true });
	const fallback = page.getByRole('link', { name: 'Open without description', exact: true });
	const query = async (link = google) => new URL(await link.getAttribute('href')).searchParams;
	const description = page.locator('#description');
	const source =
		'  Dance 🎵\nhttps://veneer.leftium.com/f.SYNTHETIC\n\n---\n\nHand-edited Form details  ';
	const fillTimes = async () => {
		await page.locator('#start').fill('2026-10-30 21:00');
		await page.locator('#end').fill('2026-10-31 02:00');
		await toggle.waitFor();
	};
	const download = async () => {
		const [file] = await Promise.all([
			page.waitForEvent('download'),
			activate(page.getByRole('button', { name: 'Download .ics', exact: true }))
		]);
		return (await fs.readFile(await file.path(), 'utf8')).replace(/\r\n /g, '');
	};
	const requests = [];
	const record = (request) => {
		if (!['script', 'stylesheet', 'image', 'font', 'other'].includes(request.resourceType()))
			requests.push(request.url());
	};
	await reset();
	page.on('request', record);
	try {
		await description.fill(source);
		await page.waitForFunction(
			() => !document.querySelector('#parse-status').textContent.includes('Parsing current')
		);
		await fillTimes();
		assert.equal(await toggle.isChecked(), true);
		assert.match(await page.locator('#end-hint').textContent(), /2026-10-31 02:00/);
		assert.equal(await endField.getByRole('checkbox', { name: 'Trim overnight tail' }).count(), 1);
		assert.equal(
			await endField.evaluate((node) =>
				node.lastElementChild?.classList.contains('overnight-export')
			),
			true
		);
		assert.equal(await page.locator('.actions .overnight-export').count(), 0);
		assert.equal(await preview.textContent(), 'Calendar end: Oct 31, 00:00');
		assert.equal(
			await endField.locator('.overnight-control').evaluate((node) => {
				const label = node.querySelector('label').getBoundingClientRect();
				const preview = node.querySelector('.calendar-end').getBoundingClientRect();
				return Math.abs((label.top + label.bottom) / 2 - (preview.top + preview.bottom) / 2) < 1;
			}),
			true
		);
		const help = endField.getByLabel('About trimming overnight tail', { exact: true });
		if (touch) await activate(help);
		else {
			await help.focus();
			await page.keyboard.press('Enter');
		}
		await endField.getByText('For events ending by 6 AM', { exact: false }).waitFor();
		assert.equal(
			await endField.locator('.overnight-help p').evaluate((node) => {
				const box = node.getBoundingClientRect();
				return box.left >= 0 && box.right <= innerWidth;
			}),
			true
		);
		await activate(help);
		const on = await query();
		assert.equal(on.get('dates'), '20261030T120000Z/20261030T150000Z');
		assert.equal(
			on.get('details'),
			`${source}\n\n---\n\nActual end: Oct 31, 2026, 02:00 (Asia/Seoul; next day)`
		);
		assert.equal(await description.inputValue(), source);
		assert.equal((await query(fallback)).get('dates'), on.get('dates'));
		assert.equal((await query(fallback)).get('details') || '', '');
		assert.equal(
			await page
				.getByText('Open without description omits the actual-end note.', { exact: true })
				.count(),
			0
		);
		const clipped = await download();
		assert.ok(clipped.includes('DTEND:20261030T150000Z\r\n'));
		assert.ok(clipped.includes('Actual end: Oct 31\\, 2026\\, 02:00 (Asia/Seoul\\; next day)'));
		const fieldHeight = (await endField.boundingBox()).height;
		if (touch) await activate(toggle);
		else {
			await toggle.focus();
			await page.keyboard.press('Space');
		}
		assert.equal(await toggle.isChecked(), false);
		assert.equal(await preview.isVisible(), false);
		assert.equal((await endField.boundingBox()).height, fieldHeight);
		assert.equal((await query()).get('dates'), '20261030T120000Z/20261030T170000Z');
		assert.equal((await query()).get('details'), source);
		const full = await download();
		assert.ok(full.includes('DTEND:20261030T170000Z\r\n'));
		assert.equal(full.match(/UID:.+/)[0], clipped.match(/UID:.+/)[0]);
		assert.equal(full.includes('Actual end:'), false);
		await activate(toggle);
		await page.locator('#end').fill('2026-10-31 03:00');
		assert.match((await query()).get('details'), /03:00/);
		assert.equal((await query()).get('details').includes('02:00'), false);
		// Multi-day events keep every earlier day and trim only the final morning.
		await page.locator('#end').fill('2026-11-01 02:00');
		assert.equal(await preview.textContent(), 'Calendar end: Nov 1, 00:00');
		assert.equal((await query()).get('dates'), '20261030T120000Z/20261031T150000Z');
		assert.equal(
			(await query()).get('details'),
			`${source}\n\n---\n\nActual end: Nov 1, 2026, 02:00 (Asia/Seoul)`
		);
		assert.equal(await description.inputValue(), source);
		assert.match(await page.locator('#end-hint').textContent(), /2026-11-01 02:00/);
		assert.equal(
			await page.getByRole('switch', { name: 'Auto End/Duration', exact: true }).isChecked(),
			false
		);
		const multi = await download();
		assert.ok(multi.includes('DTSTART:20261030T120000Z\r\nDTEND:20261031T150000Z'));
		assert.ok(multi.includes('Actual end: Nov 1\\, 2026\\, 02:00 (Asia/Seoul)'));
		await activate(toggle);
		assert.equal((await query()).get('dates'), '20261030T120000Z/20261031T170000Z');
		assert.equal((await query()).get('details'), source);
		assert.equal((await query(fallback)).get('dates'), (await query()).get('dates'));
		const multiOff = await download();
		assert.ok(multiOff.includes('DTEND:20261031T170000Z'));
		assert.equal(multiOff.match(/UID:.+/)[0], multi.match(/UID:.+/)[0]);
		await activate(toggle);
		for (const clock of ['00:01', '05:59', '06:00']) {
			await page.locator('#end').fill(`2026-11-01 ${clock}`);
			assert.equal(await toggle.isChecked(), true);
			assert.equal((await query()).get('dates'), '20261030T120000Z/20261031T150000Z');
		}
		for (const clock of ['00:00', '06:01', '17:00']) {
			await page.locator('#end').fill(`2026-11-01 ${clock}`);
			assert.equal(await toggle.count(), 0);
			assert.equal(await preview.count(), 0);
			assert.equal((await query()).get('details'), source);
		}
		await page.locator('#end').fill('2026-10-30 23:00');
		assert.equal(await toggle.count(), 0);
		assert.equal((await query()).get('details'), source);
		await page.locator('#end').fill('2026-10-31 00:00');
		assert.equal(await toggle.count(), 0);
		await fillTimes();
		assert.equal(await toggle.isChecked(), true);
		await activate(toggle);
		await description.fill(`${source}\nEdited`);
		assert.equal(await toggle.isChecked(), false);
		await reset();
		await fillTimes();
		assert.equal(await toggle.isChecked(), true);
		await activate(toggle);
		const descriptor = await page.evaluate(() => {
			window.overnightClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
			Object.defineProperty(navigator, 'clipboard', {
				configurable: true,
				value: { readText: async () => 'Replacement draft' }
			});
			return true;
		});
		assert.ok(descriptor);
		try {
			await activate(page.getByRole('button', { name: 'Paste from clipboard', exact: true }));
			await page.waitForFunction(
				() => document.querySelector('#description').value === 'Replacement draft'
			);
			await fillTimes();
			assert.equal(await toggle.isChecked(), true);
		} finally {
			await page.evaluate(() => {
				if (window.overnightClipboardDescriptor)
					Object.defineProperty(navigator, 'clipboard', window.overnightClipboardDescriptor);
				else delete navigator.clipboard;
				delete window.overnightClipboardDescriptor;
			});
		}
		await activate(page.getByRole('button', { name: 'Change time zone', exact: true }));
		await page.locator('#zone').fill('America/New_York');
		await activate(page.getByRole('button', { name: 'Done', exact: true }));
		for (const [start, end, dates] of [
			['2026-03-06 21:00', '2026-03-08 04:00', '20260307T020000Z/20260308T050000Z'],
			['2026-10-30 21:00', '2026-11-01 04:00', '20261031T010000Z/20261101T040000Z']
		]) {
			await page.locator('#start').fill(start);
			await page.locator('#end').fill(end);
			assert.equal(await toggle.isChecked(), true);
			assert.equal((await query()).get('dates'), dates);
			assert.equal((await query()).get('details').includes('next day'), false);
			assert.equal((await query(fallback)).get('dates'), dates);
			const dst = await download();
			assert.ok(dst.includes(`DTSTART:${dates.split('/')[0]}\r\nDTEND:${dates.split('/')[1]}`));
		}
		assert.deepEqual(requests, []);
	} finally {
		page.off('request', record);
		await reset();
	}
}
