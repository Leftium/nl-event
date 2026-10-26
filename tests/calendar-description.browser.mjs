import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

export async function checkCalendarDescription(page, touch = false) {
	const activate = (node) => (touch ? node.tap() : node.click());
	const reset = () => activate(page.getByRole('button', { name: 'Reset', exact: true }));
	const description = page.locator('#description');
	const chips = page.getByRole('group', { name: 'Description links', exact: true });
	const details = page.getByRole('region', { name: 'Link details', exact: true });
	const copy = page
		.locator('.description-actions')
		.getByRole('button', { name: 'Copy description', exact: true });
	const url = 'https://forms.gle/SYNTHETIC_EXPORT';
	const veneer = 'https://veneer.leftium.com/g.SYNTHETIC_EXPORT';
	const source = `Synthetic dance\n2026-11-01 19:00\nSignup: ${url}\nConfirmation: https://docs.google.com/spreadsheets/d/SYNTHETIC_SHEET/edit`;
	const reply = {
		status: 'ok',
		type: 'form',
		documentId: 'f.SYNTHETIC_RESOLVED',
		title: 'Synthetic Form title',
		infoText: 'Intro\n\nBring shoes.\n<script>plain text</script>',
		autoSheets: [{ veneerId: 's.SYNTHETIC_DISCOVERED', title: 'Discovered Sheet' }],
		autoSheetsStatus: 'partial'
	};
	const requests = [];
	let fail = false;
	let pending;
	const routeHandler = async (route) => {
		requests.push(new URL(route.request().url()));
		if (pending) await pending;
		await route.fulfill({
			contentType: 'application/json',
			body: JSON.stringify(fail ? { status: 'unavailable', type: null } : reply)
		});
	};
	await page.route('**/api/form-meta?*', routeHandler);
	await page.evaluate(() => {
		window.calendarClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
	});
	try {
		await reset();
		await description.fill(source);
		assert.equal(await page.locator('.calendar-description, [popover]').count(), 0);
		assert.equal(requests.length, 0);
		await activate(chips.getByRole('button', { name: `Details for ${url}`, exact: true }));
		await details.getByRole('button', { name: 'Add to description', exact: true }).waitFor();
		assert.equal(requests.length, 1);
		assert.equal(requests[0].search, '?id=g.SYNTHETIC_EXPORT');
		assert.equal(await description.inputValue(), source);
		await activate(details.getByLabel('Veneer link', { exact: true }));
		assert.equal(await description.inputValue(), `${veneer}\n\n---\n\n${source}`);
		await activate(details.getByRole('button', { name: 'Add to description', exact: true }));
		const composed = `${veneer}\n\n---\n\n${source}\n\n---\n\n${reply.title}\n\n${reply.infoText}`;
		assert.equal(await description.inputValue(), composed);
		assert.equal(await details.count(), 0);
		assert.equal(await chips.getByRole('button').count(), 2);
		await page.waitForFunction(() => document.querySelector('#title').value === 'Synthetic dance');
		await activate(chips.locator('.included'));
		await details.getByRole('button', { name: 'Already added', exact: true }).waitFor();
		assert.equal(requests.length, 1);
		await activate(details.getByRole('button', { name: 'Refresh', exact: true }));
		await details.getByRole('button', { name: 'Already added', exact: true }).waitFor();
		assert.equal(await description.inputValue(), composed);
		await activate(details.getByText('Confirmation Sheet', { exact: true }));
		await details
			.getByRole('option', { name: 'Discovered Sheet', exact: true })
			.waitFor({ state: 'attached' });
		await details
			.getByLabel('Confirmation Sheet', { exact: true })
			.selectOption('s.SYNTHETIC_SHEET');
		assert.ok((await description.inputValue()).startsWith(`${veneer}/s.SYNTHETIC_SHEET`));
		assert.equal(
			await details.locator('.details-url a').getAttribute('href'),
			`${veneer}/s.SYNTHETIC_SHEET`
		);
		assert.equal(
			await details.locator('.details-url a').textContent(),
			`${veneer}/s.SYNTHETIC_SHEET`
		);
		await details.getByLabel('Confirmation Sheet', { exact: true }).selectOption('');
		assert.equal(await description.inputValue(), composed);
		assert.equal(await details.locator('.details-url a').getAttribute('href'), veneer);
		await page.evaluate(() =>
			Object.defineProperty(navigator, 'clipboard', {
				configurable: true,
				value: {
					writeText: async (text) => {
						window.copiedCalendarDescription = text;
					}
				}
			})
		);
		await activate(copy);
		await page.getByText('Description copied.', { exact: true }).waitFor();
		assert.equal(await page.evaluate(() => window.copiedCalendarDescription), composed);
		await page.evaluate(() =>
			Object.defineProperty(navigator, 'clipboard', {
				configurable: true,
				value: {
					writeText: async () => {
						throw new Error('denied');
					}
				}
			})
		);
		await activate(copy);
		await page.getByText('Could not copy.', { exact: false }).waitFor();
		const google = page.getByRole('link', { name: 'Open in Google Calendar', exact: true });
		await google.waitFor();
		assert.equal(new URL(await google.getAttribute('href')).searchParams.get('details'), composed);
		const [download] = await Promise.all([
			page.waitForEvent('download'),
			activate(page.getByRole('button', { name: 'Download .ics', exact: true }))
		]);
		const ics = (await fs.readFile(await download.path(), 'utf8')).replace(/\r\n[ \t]/g, '');
		const escaped = composed
			.replace(/\\/g, '\\\\')
			.replace(/\n/g, '\\n')
			.replace(/,/g, '\\,')
			.replace(/;/g, '\\;');
		assert.ok(ics.includes(`DESCRIPTION:${escaped}\r\n`));
		await description.fill('Long description '.repeat(1000));
		await page.getByText('This Google Calendar URL is unusually long', { exact: false }).waitFor();
		assert.equal(
			new URL(
				await page
					.getByRole('link', { name: 'Open without description', exact: true })
					.getAttribute('href')
			).searchParams.get('details'),
			''
		);
		await reset();
		await description.fill(url);
		await activate(chips.getByRole('button'));
		await details.getByRole('button', { name: 'Add to description', exact: true }).waitFor();
		assert.equal(requests.length, 2);
		await activate(details.getByLabel('Veneer link', { exact: true }));
		await activate(details.getByRole('button', { name: 'Add to description', exact: true }));
		await page.waitForFunction(
			() => document.querySelector('#title').value === 'Synthetic Form title'
		);
		assert.equal(
			await description.inputValue(),
			`${veneer}\n\n---\n\n${reply.title}\n\n${reply.infoText}\n\n${url}`
		);
		await activate(chips.getByRole('button'));
		await details.getByRole('button', { name: 'Refresh', exact: true }).waitFor();
		let release;
		pending = new Promise((resolve) => {
			release = resolve;
		});
		await activate(details.getByRole('button', { name: 'Refresh', exact: true }));
		await details.getByText('Getting event details...', { exact: true }).waitFor();
		await activate(chips.getByRole('button')); // Reentry must not abandon the in-flight request.
		await description.fill('https://forms.gle/SYNTHETIC_OTHER');
		release();
		pending = undefined;
		assert.equal(await details.count(), 0);
		fail = true;
		await activate(chips.getByRole('button'));
		await details.getByRole('alert').waitFor();
		fail = false;
		await activate(details.getByRole('button', { name: 'Retry', exact: true }));
		await details.getByRole('button', { name: 'Add to description', exact: true }).waitFor();
		assert.equal(
			await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
			true
		);
	} finally {
		await page.evaluate(() => {
			if (window.calendarClipboardDescriptor)
				Object.defineProperty(navigator, 'clipboard', window.calendarClipboardDescriptor);
			else delete navigator.clipboard;
			delete window.calendarClipboardDescriptor;
		});
		await page.unroute('**/api/form-meta?*', routeHandler);
		await reset();
	}
}

export async function checkDescriptionReviewRegressions(page, touch = false) {
	const activate = (node) => (touch ? node.tap() : node.click());
	const reset = () => activate(page.getByRole('button', { name: 'Reset', exact: true }));
	const description = page.locator('#description');
	const chips = page.getByRole('group', { name: 'Description links', exact: true });
	const details = page.getByRole('region', { name: 'Link details', exact: true });
	const first = 'https://docs.google.com/forms/d/e/REVIEW_FIRST/viewform';
	const second = 'https://docs.google.com/forms/d/e/REVIEW_SECOND/viewform';
	const veneer = 'https://veneer.leftium.com/f.REVIEW_FIRST/s.REVIEW_SHEET?tabs=info#form';
	const source = `Dance party\n${first}\n${second}\nSignup: ${veneer}`;
	let version = 1;
	const routeHandler = async (route) => {
		const isFirst = new URL(route.request().url()).searchParams.get('id') === 'f.REVIEW_FIRST';
		await route.fulfill({
			contentType: 'application/json',
			body: JSON.stringify({
				status: 'ok',
				type: 'form',
				documentId: isFirst ? 'f.REVIEW_FIRST' : 'f.REVIEW_SECOND',
				title: isFirst ? 'First Form' : 'Second Form',
				infoText: isFirst ? `Introduction version ${version}` : 'Second introduction',
				autoSheets: [],
				autoSheetsStatus: 'complete'
			})
		});
	};
	await page.route('**/api/form-meta?*', routeHandler);
	const open = async (url) => {
		await activate(chips.getByRole('button', { name: `Details for ${url}`, exact: true }));
		await details.getByRole('button', { name: 'Refresh', exact: true }).waitFor();
	};
	try {
		await reset();
		await description.fill(source);
		await open(first);
		assert.equal(await details.getByLabel('Veneer link', { exact: true }).isChecked(), true);
		await details.getByLabel('Veneer link', { exact: true }).check();
		assert.equal(await description.inputValue(), source);
		assert.equal(await chips.locator('.included').count(), 1);
		await activate(details.getByText('Confirmation Sheet', { exact: true }));
		assert.equal(
			await details.getByLabel('Confirmation Sheet', { exact: true }).inputValue(),
			's.REVIEW_SHEET'
		);
		const add = details.getByRole('button', { name: 'Add to description', exact: true });
		// Scrolling the sticky editor resizes its textarea; settle that before the click's stability check.
		await add.scrollIntoViewIfNeeded();
		await activate(add);
		const initial = `${source}\n\n---\n\nFirst Form\n\nIntroduction version 1`;
		assert.equal(await description.inputValue(), initial);
		// Unchanged metadata must still allow restoring an edited import.
		const editedInitial = initial.replace('Introduction version 1', 'My first edit');
		await description.fill(editedInitial);
		await open(first);
		await activate(details.getByRole('button', { name: 'Review replacement', exact: true }));
		// Draft updates must not dismiss review when Description itself is unchanged.
		await page.locator('#title').fill('Replacement review stays open');
		await page.waitForFunction(
			() => !document.querySelector('#parse-status').textContent.includes('Parsing current')
		);
		assert.equal(
			await details
				.getByRole('group', { name: 'Replace edited Form details', exact: true })
				.count(),
			1
		);
		assert.equal(await description.inputValue(), editedInitial);
		await activate(details.getByRole('button', { name: 'Keep edits', exact: true }));
		assert.equal(await description.inputValue(), editedInitial);
		await activate(details.getByRole('button', { name: 'Review replacement', exact: true }));
		await activate(details.getByRole('button', { name: 'Replace edited details', exact: true }));
		assert.equal(await description.inputValue(), initial);
		await open(first);
		version = 2;
		await activate(details.getByRole('button', { name: 'Refresh', exact: true }));
		await details.getByRole('button', { name: 'Update description', exact: true }).waitFor();
		assert.equal(await description.inputValue(), initial);
		await activate(details.getByRole('button', { name: 'Update description', exact: true }));
		const updated = initial.replace('Introduction version 1', 'Introduction version 2');
		assert.equal(await description.inputValue(), updated);
		await open(second);
		await activate(details.getByRole('button', { name: 'Update description', exact: true }));
		const switched = `${source}\n\n---\n\nSecond Form\n\nSecond introduction`;
		assert.equal(await description.inputValue(), switched);
		const edited = switched.replace('Second introduction', 'My edited introduction');
		await description.fill(edited);
		await open(first);
		await activate(details.getByRole('button', { name: 'Review replacement', exact: true }));
		assert.equal(await description.inputValue(), edited);
		await activate(details.getByRole('button', { name: 'Keep edits', exact: true }));
		assert.equal(await description.inputValue(), edited);
		await activate(details.getByRole('button', { name: 'Review replacement', exact: true }));
		await activate(details.getByRole('button', { name: 'Replace edited details', exact: true }));
		assert.equal(await description.inputValue(), updated);
		// Edits followed by changed metadata also require explicit replacement.
		const manual = updated.replace('Introduction version 2', 'My manual version');
		await description.fill(manual);
		await open(first);
		version = 3;
		await activate(details.getByRole('button', { name: 'Refresh', exact: true }));
		await details.getByRole('button', { name: 'Review replacement', exact: true }).waitFor();
		assert.equal(await description.inputValue(), manual);
		await activate(details.getByRole('button', { name: 'Review replacement', exact: true }));
		await activate(details.getByRole('button', { name: 'Replace edited details', exact: true }));
		assert.equal(
			await description.inputValue(),
			initial.replace('Introduction version 1', 'Introduction version 3')
		);
	} finally {
		await page.unroute('**/api/form-meta?*', routeHandler);
		await reset();
	}
}
