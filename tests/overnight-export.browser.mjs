import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

export async function checkOvernightExport(page, touch = false) {
	const activate = (node) => (touch ? node.tap() : node.click());
	const reset = () => activate(page.getByRole('button', { name: 'Reset', exact: true }));
	const toggle = page.getByRole('checkbox', { name: 'Truncate overnight' });
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
		assert.match(
			await page.locator('.overnight-export').textContent(),
			/Calendar end: Oct 31, 2026, 00:00/
		);
		const help = page.getByText('About overnight exports', { exact: true });
		if (touch) await activate(help);
		else {
			await help.focus();
			await page.keyboard.press('Enter');
		}
		await page.getByText('Ends the calendar entry at midnight', { exact: false }).waitFor();
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
				.isVisible(),
			true
		);
		const clipped = await download();
		assert.ok(clipped.includes('DTEND:20261030T150000Z\r\n'));
		assert.ok(clipped.includes('Actual end: Oct 31\\, 2026\\, 02:00 (Asia/Seoul\\; next day)'));
		if (touch) await activate(toggle);
		else {
			await toggle.focus();
			await page.keyboard.press('Space');
		}
		assert.equal(await toggle.isChecked(), false);
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
		assert.deepEqual(requests, []);
	} finally {
		page.off('request', record);
		await reset();
	}
}
