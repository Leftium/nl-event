import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

async function checkDescriptionEditor(page, { touch = false } = {}) {
	const textarea = page.locator('#description');
	const reset = page.getByRole('button', { name: 'Reset', exact: true });
	const fullscreen = page.getByRole('button', { name: 'Fullscreen editor', exact: true });
	const restore = page.getByRole('button', { name: 'Restore editor', exact: true });
	const wrap = page.getByRole('button', { name: 'Word wrap', exact: true });
	const activate = (node) => (touch ? node.tap() : node.click());
	await reset.click();
	await page.waitForFunction(() => document.querySelector('#description').clientHeight > 0);
	const compact = await textarea.evaluate((node) => node.offsetHeight);
	assert.ok(compact < 100);
	assert.equal(await page.locator('.editor-counts [aria-hidden=true]').textContent(), '0w 0c');
	const long = '한글🙂 long announcement '.repeat(30) + '\n'.repeat(20);
	await textarea.fill(long);
	await page.waitForFunction(() => {
		const node = document.querySelector('#description');
		return node.offsetHeight > 100 && node.scrollHeight > node.clientHeight;
	});
	assert.ok(
		await textarea.evaluate((node) => {
			const css = getComputedStyle(node);
			return (
				node.offsetHeight <=
				parseFloat(css.lineHeight) * 6 +
					parseFloat(css.paddingTop) +
					parseFloat(css.paddingBottom) +
					parseFloat(css.borderTopWidth) +
					parseFloat(css.borderBottomWidth) +
					1
			);
		})
	);
	await activate(wrap);
	assert.equal(await textarea.getAttribute('wrap'), 'off');
	assert.ok(await textarea.evaluate((node) => node.scrollWidth > node.clientWidth));
	assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
	await activate(wrap);
	await textarea.fill('  한글🙂 title  \nsecond line  ');
	await page.locator('#title').fill('Previous manual title');
	assert.equal(await page.locator('.editor-counts [aria-hidden=true]').textContent(), '2L 4w 27c');
	await textarea.evaluate((node) => {
		window.editorTextarea = node;
		node.focus();
		node.setSelectionRange(2, 12, 'backward');
	});
	await page.evaluate(() => {
		document.body.style.setProperty('overflow-y', 'scroll', 'important');
		document.documentElement.style.setProperty('overflow-x', 'clip', 'important');
		window.editorRootStyle = document.documentElement.getAttribute('style');
		window.editorBodyStyle = document.body.getAttribute('style');
		window.editorScroll = scrollY;
	});
	await activate(fullscreen);
	assert.equal(await textarea.evaluate((node) => window.editorTextarea === node), true);
	assert.deepEqual(
		await textarea.evaluate((node) => [
			node.selectionStart,
			node.selectionEnd,
			node.selectionDirection
		]),
		[2, 12, 'backward']
	);
	await page.waitForFunction(
		() => document.querySelector('.fullscreen').getBoundingClientRect().height > 500
	);
	assert.ok(
		await page
			.locator('.fullscreen')
			.evaluate(
				(node) => node.getBoundingClientRect().right <= document.documentElement.clientWidth
			)
	);
	assert.deepEqual(
		await page.evaluate(() => {
			const style = getComputedStyle(document.documentElement);
			return [style.overflowY, style.scrollbarGutter];
		}),
		['hidden', 'auto']
	);
	assert.ok(
		await page.locator('.editor-tools').evaluate((node) => {
			const counter = node.querySelector('.editor-counts').getBoundingClientRect();
			const control = node.querySelector('button').getBoundingClientRect();
			return counter.right < control.left;
		})
	);
	if (touch) {
		assert.ok(await restore.evaluate((node) => node.offsetHeight >= 44));
		await page.setViewportSize({ width: 844, height: 390 });
		await page.waitForFunction(
			() => document.querySelector('.fullscreen').getBoundingClientRect().height <= 390
		);
		assert.ok(
			await restore.evaluate((node) => {
				const rect = node.getBoundingClientRect();
				return rect.top >= 0 && rect.bottom <= innerHeight;
			})
		);
		await page.setViewportSize({ width: 390, height: 844 });
		await page.waitForFunction(
			() => document.querySelector('.fullscreen').getBoundingClientRect().height > 500
		);
	}
	await page.screenshot({
		path: path.join(
			os.tmpdir(),
			`nl-event-editor-${page.context().browser().browserType().name()}-${touch ? 'touch' : 'desktop'}-fullscreen.png`
		)
	});
	const action = page.getByRole('button', { name: 'Use selection as Title', exact: true });
	await activate(action);
	await page.waitForFunction(
		() =>
			document.querySelector('#title').value === '한글🙂 title' &&
			document.activeElement?.id === 'title'
	);
	assert.equal(await page.locator('#title').inputValue(), '한글🙂 title');
	assert.equal(
		await page.locator('#title').evaluate((node) => node === document.activeElement),
		true
	);
	assert.equal(await restore.count(), 0);
	assert.equal(
		await page.getByRole('switch', { name: 'Auto Title', exact: true }).isChecked(),
		false
	);
	assert.equal(
		await page.evaluate(() => document.body.getAttribute('style') || ''),
		await page.evaluate(() => window.editorBodyStyle || '')
	);
	assert.equal(
		await page.evaluate(() => document.documentElement.getAttribute('style') || ''),
		await page.evaluate(() => window.editorRootStyle || '')
	);
	// Start native undo coverage with a fresh editing history, independent of fill() setup.
	await page.reload();
	await page.waitForFunction(() => !document.querySelector('#description').disabled);
	await activate(fullscreen);
	// Enter must flow through beforeinput/input, update parsing, and keep native undo.
	await textarea.pressSequentially('Title: Native');
	await textarea.evaluate((node) => {
		window.editorEvents = [];
		for (const type of ['beforeinput', 'input'])
			node.addEventListener(type, (event) =>
				window.editorEvents.push([type, event.inputType, event.isTrusted])
			);
	});
	await textarea.press('End');
	await textarea.press('Enter');
	assert.equal(await textarea.inputValue(), 'Title: Native\n');
	assert.ok(
		await page.evaluate(() =>
			window.editorEvents.some(
				([type, input, trusted]) => type === 'input' && input === 'insertLineBreak' && trusted
			)
		)
	);
	assert.ok(
		await page.evaluate(() =>
			window.editorEvents.some(
				([type, input, trusted]) => type === 'beforeinput' && input === 'insertLineBreak' && trusted
			)
		)
	);
	await textarea.press('ControlOrMeta+z');
	// Browsers may group preceding typing with Enter in one native undo unit.
	assert.notEqual(await textarea.inputValue(), 'Title: Native\n');
	await textarea.press('ControlOrMeta+Shift+z');
	assert.equal(await textarea.inputValue(), 'Title: Native\n');
	if (!touch) {
		await textarea.evaluate((node) => {
			node.focus();
			node.setSelectionRange(7, 13);
		});
		await action.waitFor();
		await textarea.press(
			page.context().browser().browserType().name() === 'webkit' ? 'Alt+Tab' : 'Tab'
		);
		assert.equal(await action.evaluate((node) => node === document.activeElement), true);
		await page.keyboard.press('Space');
		await page.waitForFunction(() => document.activeElement?.id === 'title');
		assert.equal(await page.locator('#title').inputValue(), 'Native');
		await activate(fullscreen);
	}
	// Composition events must not trigger fullscreen Escape handling.
	await textarea.dispatchEvent('keydown', { key: 'Escape', isComposing: true });
	assert.equal(await restore.count(), 1);
	await textarea.press('Escape');
	assert.equal(await restore.count(), 0);
	assert.equal(await textarea.evaluate((node) => node === document.activeElement), true);
	await textarea.evaluate((node) => node.setSelectionRange(node.value.length, node.value.length));
	await textarea.press('Enter');
	assert.equal(await textarea.inputValue(), 'Title: Native\n\n');
	if (!touch && page.context().browser().browserType().name() === 'chromium') {
		const session = await page.context().newCDPSession(page);
		await session.send('Input.imeSetComposition', {
			text: '한',
			selectionStart: 1,
			selectionEnd: 1
		});
		await session.send('Input.insertText', { text: '한글' });
		assert.equal(await textarea.inputValue(), 'Title: Native\n\n한글');
		assert.ok(
			await page.evaluate(() =>
				window.editorEvents.some(
					([type, input, trusted]) =>
						type === 'input' && input === 'insertCompositionText' && trusted
				)
			)
		);
		await session.detach();
	}
	// Exercise the browser paste input contract without reading the host clipboard.
	// Ordinary input schedules 250ms; insertFromPaste parses immediately in the parent.
	assert.deepEqual(
		await textarea.evaluate((node) => {
			const scheduled = [];
			const original = window.setTimeout;
			window.setTimeout = (...args) => {
				if (args[1] === 250) scheduled.push(250);
				return original(...args);
			};
			try {
				node.value = 'Ordinary edit';
				node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
				const ordinary = scheduled.length;
				node.value = '  Pasted 한글🙂\nexact text  \n';
				node.dispatchEvent(
					new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' })
				);
				return [ordinary, scheduled.length];
			} finally {
				window.setTimeout = original;
			}
		}),
		[1, 1]
	);
	await page.waitForFunction(
		() => !document.querySelector('#parse-status').textContent.includes('Parsing current')
	);
	assert.equal(await textarea.inputValue(), '  Pasted 한글🙂\nexact text  \n');
	assert.equal(await page.locator('.editor-counts [aria-hidden=true]').textContent(), '3L 4w 26c');
	await activate(fullscreen);
	await activate(restore);
	assert.equal(await page.evaluate(() => document.body.getAttribute('style') || ''), '');
	await reset.click();
	await page.waitForFunction(
		(height) => document.querySelector('#description').offsetHeight === height,
		compact
	);
	assert.equal(await textarea.evaluate((node) => node === document.activeElement), true);
	assert.equal(await page.locator('.editor-counts [aria-hidden=true]').textContent(), '0w 0c');
	await page.screenshot({
		path: path.join(
			os.tmpdir(),
			`nl-event-editor-${page.context().browser().browserType().name()}-${touch ? 'touch' : 'desktop'}.png`
		),
		fullPage: true
	});
}

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
	const newEvent = page.getByRole('button', { name: 'Reset', exact: true });
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
		await newEvent.click();
		await complete(index, text, reject);
		assert.deepEqual(
			await page
				.locator('textarea:visible, input[type=text]:visible')
				.evaluateAll((nodes) => nodes.map((n) => n.value)),
			['', '', '', '', '']
		);
		assert.equal(await page.getByRole('status', { includeHidden: true }).textContent(), '');
		assert.equal(await paste.isEnabled(), true);
	}

	// A successful clipboard read replaces a populated draft directly.
	await page.locator('#description').fill('Replace this draft');
	await paste.click();
	assert.equal(
		await page.getByRole('button', { name: 'Reading clipboard...', exact: true }).isDisabled(),
		true
	);
	await complete(3, 'Valid clipboard text' + '\n'.repeat(12));
	assert.equal(
		await page.locator('#description').inputValue(),
		'Valid clipboard text' + '\n'.repeat(12)
	);
	assert.equal(
		await page.locator('#description').evaluate((node) => node === document.activeElement),
		true
	);
	await page.waitForFunction(
		() =>
			document.querySelector('#description').scrollHeight >
			document.querySelector('#description').clientHeight
	);
	assert.match(await page.locator('.editor-counts [aria-hidden=true]').textContent(), /^13L 3w/);
	assert.equal(await page.getByRole('status', { includeHidden: true }).textContent(), '');

	// A stale completion must not clear a newer read's busy state or message.
	await paste.click();
	await newEvent.click();
	await paste.click();
	await complete(4, '', true);
	assert.equal(
		await page.getByRole('button', { name: 'Reading clipboard...', exact: true }).isDisabled(),
		true
	);
	assert.equal(await page.getByRole('status', { includeHidden: true }).textContent(), '');
	await complete(5, 'Current clipboard text');
	assert.equal(await page.locator('#description').inputValue(), 'Current clipboard text');
	assert.equal(await paste.isEnabled(), true);
	await newEvent.click();
}

async function checkEnglishDates(page) {
	await page.clock.setFixedTime(new Date('2026-10-24T03:00:00Z'));
	await page.setViewportSize({ width: 390, height: 844 });
	const download = page.getByRole('button', { name: 'Download .ics', exact: true });
	for (const [text, label] of [
		['sleep tonight', '2026-10-24: Date known; night has no exact time'],
		['sleep tomorrow night', '2026-10-25: Date known; night has no exact time'],
		['cancel netflix next month', '2026-11: day unresolved']
	]) {
		await page.getByRole('button', { name: 'Reset', exact: true }).click();
		await page.locator('#description').fill(text);
		await page.getByText(label, { exact: true }).waitFor();
		assert.equal(await page.locator('#start').inputValue(), '');
		assert.equal(await download.isDisabled(), true);
		assert.equal(
			await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
			true
		);
	}
	await page.screenshot({
		path: path.join(
			os.tmpdir(),
			`nl-event-english-month-${page.context().browser().browserType().name()}.png`
		),
		fullPage: true
	});
	const dates = page.getByRole('list', { name: 'Start date alternatives', exact: true });
	assert.deepEqual(
		(await dates.getByRole('button').allTextContents()).map((text) => text.trim()),
		['Today', 'Tomorrow', 'In 7 days', 'In 30 days']
	);
	await dates.getByRole('button', { name: 'Tomorrow', exact: true }).hover();
	await page.getByRole('tooltip').waitFor();
	assert.match(await page.getByRole('tooltip').textContent(), /not extracted/);
	await page.getByRole('button', { name: 'Reset', exact: true }).click();
	await page.locator('#description').fill('cancel netflix on the 5th of next month');
	await page.waitForFunction(
		() => document.querySelector('#start').value === 'on the 5th of next month'
	);
	assert.match(await page.locator('#start-hint').textContent(), /2026-11-05 09:00/);
	assert.equal(await download.isEnabled(), true);
	await page.getByRole('button', { name: 'Reset', exact: true }).click();
	await page.locator('#description').fill('tonight from 11pm to 1am');
	await page.waitForFunction(
		() => document.querySelector('#end').value === 'tonight from 11pm to 1am'
	);
	assert.match(await page.locator('#start-hint').textContent(), /2026-10-24 23:00/);
	assert.match(await page.locator('#end-hint').textContent(), /2026-10-25 01:00/);
	assert.equal(await download.isEnabled(), true);
	await page.screenshot({
		path: path.join(
			os.tmpdir(),
			`nl-event-english-${page.context().browser().browserType().name()}.png`
		),
		fullPage: true
	});
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.getByRole('button', { name: 'Reset', exact: true }).click();
}

async function checkCandidates(page) {
	const settled = () =>
		page.waitForFunction(
			() => !document.querySelector('#parse-status').textContent.includes('Parsing current')
		);
	const reset = async () => {
		await page.getByRole('button', { name: 'Reset', exact: true }).click();
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
		assert.equal(await page.locator('fieldset.event-field').count(), 4);
		assert.equal(
			await page.locator('.event-field').evaluateAll((groups) =>
				groups.every((group) => {
					const hint = group.querySelector('small');
					const options = group.querySelector('.temporal-options, .suggestions');
					return (
						!options ||
						options.getBoundingClientRect().top - hint.getBoundingClientRect().bottom <= 12
					);
				})
			),
			true
		);
		assert.equal(
			await page
				.getByText(
					/^(inferred-year|inferred-time|assumed-end|past-event|ambiguous-am-pm|weekday-mismatch|multiple-source-dates)$/
				)
				.count(),
			0
		);
		for (const [field, expected] of Object.entries(fixture.assertions.preferred ?? {})) {
			if (field.endsWith('Contains'))
				assert.ok(
					(await page.locator(`#${field.replace('Contains', '')}`).inputValue()).includes(expected)
				);
			else if ((field === 'start' || field === 'end') && expected) {
				const label = field === 'start' ? 'Start' : 'End/Duration';
				const date = page
					.getByRole('list', { name: `${label} date alternatives`, exact: true })
					.getByRole('button', { name: expected.slice(0, 10), exact: true });
				assert.equal(await date.getAttribute('aria-pressed'), 'true');
				if (expected.length > 10) {
					const time = page
						.getByRole('list', { name: `${label} time alternatives`, exact: true })
						.getByRole('button', { name: expected.slice(11, 16), exact: true });
					assert.equal(await time.getAttribute('aria-pressed'), 'true');
				}
			} else assert.equal(await page.locator(`#${field}`).inputValue(), expected ?? '');
		}
		assert.equal(await page.locator('#description').inputValue(), text);
		if (fixture.id === 'k1-wine-excerpt')
			assert.equal(await page.locator('#start').inputValue(), '10/25(일) 오후 5시');
		if (fixture.id === 'e1-st-paul-houseparty-sanitized') {
			assert.equal(await page.locator('#start').inputValue(), 'November 14th, 2026, 8 pm');
			assert.equal(await page.locator('#end').inputValue(), 'November 14th, 2026, 8 pm - midnight');
		}

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
		.getByRole('list', { name: 'Start date alternatives', exact: true })
		.getByRole('button', { name: '2026-07-11', exact: true });
	await alternative.hover();
	await page.getByRole('tooltip').waitFor({ timeout: 750 });
	assert.match(await page.getByRole('tooltip').textContent(), /7\/11/);
	assert.equal(await alternative.getAttribute('title'), null);
	await alternative.click();
	assert.equal(await page.locator('#start').inputValue(), '7/11 16:30');
	assert.equal(await page.locator('#end').inputValue(), end);
	await page
		.getByRole('list', { name: 'End/Duration date alternatives', exact: true })
		.getByRole('button', { name: '2026-07-11', exact: true })
		.click();
	await page.getByRole('switch', { name: 'Auto End/Duration', exact: true }).click();
	assert.equal(await page.locator('#end').inputValue(), '7/11 18:00');
	assert.match(await page.locator('#end-hint').textContent(), /Interpreted as 2026-07-11 18:00/);
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
		await page.getByRole('list', { name: 'Start date alternatives', exact: true }).count(),
		0
	);
	await settled();
	assert.equal(await page.locator('#title').inputValue(), 'My title');
	await page.locator('#description').fill('');
	assert.equal(await page.locator('#start').inputValue(), '7/11 16:30');
	assert.equal(await page.locator('#end').inputValue(), '');
	assert.equal(
		await page.getByRole('list', { name: 'Start date alternatives', exact: true }).count(),
		0
	);
	await reset();
	await page.locator('#description').fill('Class 1: Example: 12:15 - 1:15 pm');
	await settled();
	await page
		.getByRole('list', { name: 'Start time alternatives', exact: true })
		.getByRole('button', { name: '12:15', exact: true })
		.click();
	assert.equal(await page.locator('#start').inputValue(), '12:15');
	assert.equal(
		await page.getByRole('button', { name: 'Download .ics', exact: true }).isDisabled(),
		true
	);
	await page.locator('#start').fill('2026-05-16');
	await page
		.getByRole('list', { name: 'Start time alternatives', exact: true })
		.getByRole('button', { name: 'All day', exact: true })
		.click();
	await page
		.getByRole('list', { name: 'Start time alternatives', exact: true })
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
			.locator('textarea:visible, input[type=text]:visible')
			.evaluateAll((nodes) => nodes.map((n) => n.value)),
		['', '', '', '', '']
	);
}

async function checkSlowSaturday(page) {
	const text = await fs.readFile('tests/inputs/slow-saturday-user.txt', 'utf8');
	await page.locator('#description').fill(text);
	await page.waitForFunction(
		() => !document.querySelector('#parse-status').textContent.includes('Parsing current')
	);
	assert.match(await page.locator('#start-hint').textContent(), /2026-07-04 16:30/);
	assert.match(await page.locator('#end-hint').textContent(), /2026-07-04 18:00/);
	const startOptions = page.getByRole('list', { name: 'Start date alternatives', exact: true });
	const endOptions = page.getByRole('list', {
		name: 'End/Duration date alternatives',
		exact: true
	});
	assert.equal(await startOptions.getByRole('button').count(), 12);
	assert.equal(
		await page
			.getByRole('list', { name: 'Start time alternatives', exact: true })
			.getByRole('button')
			.count(),
		4
	);
	assert.equal(await endOptions.getByRole('button').count(), 12);
	assert.equal(
		await page
			.getByRole('list', { name: 'End/Duration time alternatives', exact: true })
			.getByRole('button')
			.count(),
		4
	);
	assert.equal(
		await startOptions
			.getByRole('button', { name: '2026-07-04', exact: true })
			.getAttribute('aria-pressed'),
		'true'
	);
	assert.equal(
		await endOptions
			.getByRole('button', { name: '2026-07-04', exact: true })
			.getAttribute('aria-pressed'),
		'true'
	);
	assert.equal(
		await page
			.getByRole('list', { name: 'End/Duration duration alternatives', exact: true })
			.getByRole('button')
			.count(),
		8
	);
	assert.equal(await page.locator('#location').inputValue(), '');
	await startOptions.getByRole('button', { name: '2026-07-11', exact: true }).click();
	await endOptions.getByRole('button', { name: '2026-07-11', exact: true }).click();
	const google = page.getByRole('link', { name: 'Open in Google Calendar' });
	assert.equal(
		new URL(await google.getAttribute('href')).searchParams.get('dates'),
		'20260711T073000Z/20260711T090000Z'
	);
	await page.setViewportSize({ width: 390, height: 844 });
	assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
	await page.screenshot({
		path: path.join(
			os.tmpdir(),
			`nl-event-slow-saturday-${page.context().browser().browserType().name()}.png`
		),
		fullPage: true
	});
	await page.getByRole('button', { name: 'Reset', exact: true }).click();
}

async function checkOctoberMidnight(page) {
	const text = await fs.readFile('tests/inputs/blues-jam-october-sanitized.txt', 'utf8');
	await page.locator('#description').fill(text);
	await page.waitForFunction(
		() => !document.querySelector('#parse-status').textContent.includes('Parsing current')
	);
	assert.equal(await page.locator('#description').inputValue(), text);
	assert.match(await page.locator('#start-hint').textContent(), /2026-10-30 20:00/);
	assert.match(await page.locator('#end-hint').textContent(), /2026-10-31 00:00/);
	for (const field of ['Start', 'End/Duration']) {
		const dates = page.getByRole('list', { name: `${field} date alternatives`, exact: true });
		assert.deepEqual(
			await dates
				.getByRole('button')
				.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('aria-label'))),
			['2026-10-30', '2026-10-31']
		);
		const times = page.getByRole('list', { name: `${field} time alternatives`, exact: true });
		assert.equal(await times.getByRole('button', { name: '22:00', exact: true }).count(), 1);
		assert.equal(await times.getByRole('button', { name: '24:00', exact: true }).count(), 0);
	}
	assert.equal(
		await page
			.getByRole('list', { name: 'End/Duration duration alternatives', exact: true })
			.getByRole('button', { name: '4h', exact: true })
			.getAttribute('aria-pressed'),
		'true'
	);
	const query = new URL(
		await page.getByRole('link', { name: 'Open in Google Calendar' }).getAttribute('href')
	).searchParams;
	assert.equal(query.get('dates'), '20261030T110000Z/20261030T150000Z');
	assert.equal(query.get('details'), text);
	const pending = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Download .ics', exact: true }).click();
	const ics = (await fs.readFile(await (await pending).path(), 'utf8')).replace(/\r\n /g, '');
	assert.match(ics, /DTSTART:20261030T110000Z\r\nDTEND:20261030T150000Z/);
	assert.ok(ics.includes(`DESCRIPTION:${text.replace(/\n/g, '\\n')}\r\n`));
	await page.getByRole('button', { name: 'Reset', exact: true }).click();
}

async function checkRhythmParty(page) {
	await page
		.locator('#description')
		.fill(await fs.readFile('tests/inputs/rhythm-party-user.txt', 'utf8'));
	await page.waitForFunction(
		() => !document.querySelector('#parse-status').textContent.includes('Parsing current')
	);
	const dates = page.getByRole('list', { name: 'Start date alternatives', exact: true });
	const times = page.getByRole('list', { name: 'Start time alternatives', exact: true });
	const endDates = page.getByRole('list', { name: 'End/Duration date alternatives', exact: true });
	const endTimes = page.getByRole('list', { name: 'End/Duration time alternatives', exact: true });
	assert.equal(await dates.getByRole('button').count(), 3);
	assert.equal(
		await dates
			.getByRole('button', { name: '2026-08-14', exact: true })
			.getAttribute('aria-pressed'),
		'true'
	);
	assert.equal(
		await times.getByRole('button', { name: '23:00', exact: true }).getAttribute('aria-pressed'),
		'true'
	);
	assert.equal(await times.getByRole('button', { name: '23:00', exact: true }).isEnabled(), true);
	assert.equal(
		await endDates
			.getByRole('button', { name: '2026-08-15', exact: true })
			.getAttribute('aria-pressed'),
		'true'
	);
	assert.equal(
		await endTimes.getByRole('button', { name: '03:30', exact: true }).getAttribute('aria-pressed'),
		'true'
	);
	assert.equal(await page.locator('#location').inputValue(), '서울 서대문구 명물길 37');
	const google = page.getByRole('link', { name: 'Open in Google Calendar' });
	assert.equal(
		new URL(await google.getAttribute('href')).searchParams.get('dates'),
		'20260814T140000Z/20260814T183000Z'
	);
	const download = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Download .ics', exact: true }).click();
	assert.match(
		await fs.readFile(await (await download).path(), 'utf8'),
		/DTSTART:20260814T140000Z\r\nDTEND:20260814T183000Z/
	);
	await page.setViewportSize({ width: 390, height: 844 });
	await page.screenshot({
		path: path.join(
			os.tmpdir(),
			`nl-event-rhythm-party-${page.context().browser().browserType().name()}.png`
		),
		fullPage: true
	});
	assert.equal(
		await page
			.getByRole('list', { name: 'End/Duration duration alternatives', exact: true })
			.getByRole('button', { name: '4h 30m', exact: true })
			.getAttribute('aria-pressed'),
		'true'
	);
	assert.deepEqual(
		await dates
			.locator('button')
			.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label'))),
		['2026-08-12', '2026-08-14', '2026-08-15']
	);
	await dates.getByRole('button', { name: '2026-08-15', exact: true }).click();
	assert.equal(await page.locator('#start').inputValue(), '2026년 8월 14일 00:30');
	await times.getByRole('button', { name: '00:30', exact: true }).click();
	assert.equal(await page.locator('#start').inputValue(), '2026년 8월 14일 00:30');
	await dates.getByRole('button', { name: '2026-08-12', exact: true }).click();
	assert.equal(await page.locator('#start').inputValue(), '8/12');
	assert.equal(
		await times.getByRole('button', { name: 'All day', exact: true }).getAttribute('aria-pressed'),
		'true'
	);
	assert.match(
		await dates
			.getByRole('button', { name: '2026-08-12', exact: true })
			.getAttribute('data-tooltip'),
		/파티비.*8\/12/
	);
	await endDates.getByRole('button', { name: '2026-08-12', exact: true }).click();
	assert.equal(await page.locator('#end').inputValue(), '8/12');
	assert.equal(
		new URL(await google.getAttribute('href')).searchParams.get('dates'),
		'20260812/20260813'
	);
	await times.getByRole('button', { name: '00:30', exact: true }).click();
	assert.equal(
		await times.getByRole('button', { name: 'All day', exact: true }).getAttribute('aria-pressed'),
		'false'
	);
	await endTimes.getByRole('button', { name: '03:30', exact: true }).click();
	assert.equal(
		new URL(await google.getAttribute('href')).searchParams.get('dates'),
		'20260811T153000Z/20260811T183000Z'
	);
	assert.equal(
		await page
			.getByText('Not paired in source', {
				exact: true
			})
			.count(),
		2
	);

	await page.getByRole('button', { name: 'Reset', exact: true }).click();
}

async function checkDurations(page) {
	const durations = page.getByRole('list', {
		name: 'End/Duration duration alternatives',
		exact: true
	});
	assert.equal(await durations.getByRole('button', { name: '1h', exact: true }).isDisabled(), true);
	await page.locator('#start').fill('2026-10-25 19:00');
	await page.locator('#end').fill('2026-10-25 20:45');
	assert.equal(
		await durations
			.getByRole('button', { name: '1h 45m', exact: true })
			.getAttribute('aria-pressed'),
		'true'
	);
	assert.match(
		await page.locator('#end').locator('..').locator('.part-label').first().textContent(),
		/Duration.*1h 45m/
	);
	await durations.getByRole('button', { name: '1h 30m', exact: true }).click();
	assert.equal(await page.locator('#end').inputValue(), '1h 30m');
	await page.locator('#start').fill('2026-10-25 20:00');
	assert.match(await page.locator('#end-hint').textContent(), /2026-10-25 21:30/);
	await page.locator('#end').fill('2026-10-25 22:00');
	assert.equal(
		await durations.getByRole('button', { name: '2h', exact: true }).getAttribute('aria-pressed'),
		'true'
	);
	await page
		.getByRole('list', { name: 'Start time alternatives', exact: true })
		.getByRole('button', { name: 'All day', exact: true })
		.click();
	assert.equal(
		await durations
			.getByRole('button', { name: '1 day', exact: true })
			.getAttribute('aria-pressed'),
		'true'
	);
	await durations.getByRole('button', { name: '2 days', exact: true }).click();
	assert.equal(await page.locator('#end').inputValue(), '2 days');
	await page.locator('#start').fill('2026-10-26');
	assert.match(await page.locator('#end-hint').textContent(), /2026-10-27/);
	const google = page.getByRole('link', { name: 'Open in Google Calendar' });
	assert.equal(
		new URL(await google.getAttribute('href')).searchParams.get('dates'),
		'20261026/20261028'
	);
	await page.locator('#end').fill('5 days');
	assert.equal(
		await durations
			.getByRole('button', { name: '5 days', exact: true })
			.getAttribute('aria-pressed'),
		'true'
	);
	await page.getByRole('button', { name: 'Reset', exact: true }).click();
}

async function checkTemporalParts(page) {
	await page.locator('#description').fill('October 25, 2026 at 7pm\nOctober 26, 2026 at 8pm');
	await page.waitForFunction(
		() => !document.querySelector('#parse-status').textContent.includes('Parsing current')
	);
	const dates = page.getByRole('list', { name: 'Start date alternatives', exact: true });
	const times = page.getByRole('list', { name: 'Start time alternatives', exact: true });
	assert.match(
		await dates.getByRole('button', { name: '2026-10-26', exact: true }).textContent(),
		/Mon, \+2d/
	);
	const end = await page.locator('#end').inputValue();
	await dates.getByRole('button', { name: '2026-10-26', exact: true }).focus();
	await page.keyboard.press('Space');
	assert.equal(
		await times.getByRole('button', { name: '20:00', exact: true }).getAttribute('aria-pressed'),
		'true'
	);
	assert.equal(await times.getByRole('button', { name: '19:00', exact: true }).isEnabled(), true);
	const paired = times.getByRole('button', { name: '20:00', exact: true });
	const unpaired = times.getByRole('button', { name: '19:00', exact: true });
	assert.equal(await paired.evaluate((node) => getComputedStyle(node).borderTopStyle), 'solid');
	assert.equal(await unpaired.evaluate((node) => getComputedStyle(node).borderTopStyle), 'dashed');
	assert.match(await paired.getAttribute('data-tooltip'), /^Paired with this date/);
	assert.match(await unpaired.getAttribute('data-tooltip'), /^Not paired with this date/);

	await times.getByRole('button', { name: '19:00', exact: true }).click();
	assert.equal(
		await dates
			.getByRole('button', { name: '2026-10-26', exact: true })
			.getAttribute('aria-pressed'),
		'true'
	);
	assert.equal(await page.locator('#end').inputValue(), end);
	assert.equal(await page.locator('#start').inputValue(), 'October 26, 2026 7pm');
	assert.equal(await unpaired.getAttribute('aria-pressed'), 'true');
	assert.equal(await unpaired.evaluate((node) => getComputedStyle(node).borderTopStyle), 'dashed');
	assert.equal(await page.locator('.part-label .pairing-warning').count(), 1);
	await times.getByRole('button', { name: '20:00', exact: true }).click();
	assert.equal(await page.locator('#start').inputValue(), 'October 26, 2026 at 8pm');
	await page
		.getByRole('list', { name: 'End/Duration date alternatives', exact: true })
		.getByRole('button', { name: '2026-10-26', exact: true })
		.click();
	await page
		.getByRole('list', { name: 'End/Duration time alternatives', exact: true })
		.getByRole('button', { name: '21:00', exact: true })
		.click();
	const google = page.getByRole('link', { name: 'Open in Google Calendar' });
	assert.equal(
		new URL(await google.getAttribute('href')).searchParams.get('dates'),
		'20261026T110000Z/20261026T120000Z'
	);
	await page
		.getByRole('list', { name: 'Start time alternatives', exact: true })
		.getByRole('button', { name: 'All day', exact: true })
		.click();
	assert.equal(
		await times.getByRole('button', { name: 'All day', exact: true }).getAttribute('aria-pressed'),
		'true'
	);
	await page.getByRole('button', { name: 'Reset', exact: true }).click();
}

async function checkFreeform(page) {
	await page.locator('#start').fill('tomorrow at 7pm');
	await page.locator('#end').fill('tomorrow at 8pm');
	assert.match(
		await page.locator('#start-hint').textContent(),
		/Interpreted as 2026-10-25 19:00 \(Sun, \+1d\)/
	);
	assert.match(await page.locator('#end-hint').textContent(), /Interpreted as 2026-10-25 20:00/);
	assert.equal(await page.locator('#start').inputValue(), 'tomorrow at 7pm');
	const google = page.getByRole('link', { name: 'Open in Google Calendar' });
	assert.equal(
		new URL(await google.getAttribute('href')).searchParams.get('dates'),
		'20261025T100000Z/20261025T110000Z'
	);
	const pending = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Download .ics', exact: true }).click();
	const output = await fs.readFile(await (await pending).path(), 'utf8');
	assert.ok(output.includes('DTSTART:20261025T100000Z\r\nDTEND:20261025T110000Z'));
	assert.equal(await page.locator('#start').inputValue(), 'tomorrow at 7pm');
	await page.locator('#start').fill('tomorrow evening');
	assert.match(await page.locator('#start-error').textContent(), /time missing/);
	assert.equal(
		await page.getByRole('button', { name: 'Download .ics', exact: true }).isDisabled(),
		true
	);
	await page.locator('#start').fill('7pm');
	assert.match(await page.locator('#start-error').textContent(), /date missing/);
	await page.locator('#start').fill('tomorrow at 7pm');
	await page.locator('#end').fill('4hr');
	assert.match(await page.locator('#end-hint').textContent(), /2026-10-25 23:00/);
	await page.locator('#start').fill('tomorrow at 8pm');
	assert.equal(await page.locator('#end').inputValue(), '4hr');
	assert.match(await page.locator('#end-hint').textContent(), /2026-10-26 00:00/);
	assert.equal(
		new URL(await google.getAttribute('href')).searchParams.get('dates'),
		'20261025T110000Z/20261025T150000Z'
	);
	const durationDownload = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Download .ics', exact: true }).click();
	assert.ok(
		(await fs.readFile(await (await durationDownload).path(), 'utf8')).includes(
			'DTEND:20261025T150000Z'
		)
	);
	await page.locator('#start').fill('tomorrow evening');
	assert.match(await page.locator('#end-error').textContent(), /Complete a timed Start/);

	await page.locator('#start').fill('30min');
	await page.locator('#end').fill('2hr');
	assert.match(await page.locator('#start-hint').textContent(), /2026-10-24 12:30 \(Sat, today\)/);
	assert.match(await page.locator('#end-hint').textContent(), /2026-10-24 14:30/);
	await page.clock.setFixedTime(new Date('2026-10-24T04:00:00Z'));
	await page.locator('#end').fill('4hr');
	assert.match(await page.locator('#start-hint').textContent(), /2026-10-24 12:30/);
	assert.match(await page.locator('#end-hint').textContent(), /2026-10-24 16:30/);
	await page.locator('#start').fill('1hr');
	assert.match(await page.locator('#start-hint').textContent(), /2026-10-24 14:00/);
	assert.equal(await page.locator('#start').inputValue(), '1hr');
	assert.equal(
		new URL(await google.getAttribute('href')).searchParams.get('dates'),
		'20261024T050000Z/20261024T090000Z'
	);
	await page.clock.setFixedTime(new Date('2026-10-24T03:00:00Z'));
	await page.locator('#start').fill('all day tomorrow');
	await page.locator('#end').fill('all day day after tomorrow');
	assert.match(await page.locator('#end-hint').textContent(), /2026-10-26.*inclusive end/);
	assert.equal(
		new URL(await google.getAttribute('href')).searchParams.get('dates'),
		'20261025/20261027'
	);
	await page.getByRole('button', { name: 'Reset', exact: true }).click();
}

async function checkMapLocations(page) {
	const announcement = await fs.readFile('tests/inputs/multiline-location-user.txt', 'utf8');
	const flattened = await fs.readFile(
		'tests/fixtures/nl-event/inputs/k2-milonga-excerpt.txt',
		'utf8'
	);
	for (const { text, address, venue } of [
		{ text: announcement, address: '연남동 568-51', venue: '피스타' },
		{ text: flattened, address: '연남동 568-51', venue: '피스타' },
		{
			text: 'Tomorrow at 7pm\n장소: 피스타\n연남동 568-51(B1)\n홍대역 2번출구',
			address: '연남동 568-51',
			venue: '피스타'
		},
		{
			text: 'Tomorrow at 7pm\nLocation: The Hall\n123 Main Street (Suite 2)\nWalk 5 minutes from the station',
			address: '123 Main Street',
			venue: 'The Hall'
		}
	]) {
		await page.getByRole('button', { name: 'Reset', exact: true }).click();
		await page.locator('#description').fill(text);
		await page.waitForFunction(
			(address) => document.querySelector('#location').value === address,
			address
		);
		assert.equal(await page.locator('#description').inputValue(), text);
		const options = page.getByRole('list', { name: 'Location alternatives', exact: true });
		assert.equal(await options.getByRole('button', { name: venue, exact: true }).count(), 1);
		assert.equal(await options.getByRole('button').count(), 2);
		const google = new URL(
			await page.getByRole('link', { name: 'Open in Google Calendar' }).getAttribute('href')
		);
		assert.equal(google.searchParams.get('location'), address);
		assert.equal(google.searchParams.get('details'), text);
		const pending = page.waitForEvent('download');
		await page.getByRole('button', { name: 'Download .ics', exact: true }).click();
		const ics = (await fs.readFile(await (await pending).path(), 'utf8')).replace(/\r\n /g, '');
		assert.ok(ics.includes(`LOCATION:${address}\r\n`));
		assert.ok(ics.includes(venue));
		assert.ok(ics.includes(text.includes('(B1)') ? '(B1)' : '(Suite 2)'));
		await options.getByRole('button', { name: venue, exact: true }).click();
		assert.equal(await page.locator('#location').inputValue(), venue);
		assert.equal(
			await page.getByRole('switch', { name: 'Auto Location', exact: true }).isChecked(),
			false
		);
		await page.getByRole('switch', { name: 'Auto Location', exact: true }).click();
		assert.equal(await page.locator('#location').inputValue(), address);
	}
}

async function checkSelectionActions(page, { touch = false } = {}) {
	const textarea = page.locator('#description');
	const selected = ' 한글🙂 venue ';
	const text = `Title: Original\nTomorrow at 7pm\nLocation: The Hall\n[${selected}]`;
	const activate = (action) => (touch ? action.tap() : action.click());
	const waitParsed = () =>
		page.waitForFunction(
			() => !document.querySelector('#parse-status').textContent.includes('Parsing current')
		);
	const capture = async () => {
		await textarea.evaluate((node, selected) => {
			node.focus();
			const start = node.value.indexOf(selected);
			node.setSelectionRange(start, start + selected.length);
		}, selected);
		await page.getByRole('button', { name: 'Use selection as Location', exact: true }).waitFor();
	};
	for (const field of ['title', 'location']) {
		for (const fullscreen of [false, true]) {
			for (const method of touch ? ['touch'] : ['mouse', 'keyboard']) {
				await page.getByRole('button', { name: 'Reset', exact: true }).click();
				await textarea.fill(text);
				await waitParsed();
				const before = await Promise.all(
					['title', 'start', 'end', 'location'].map((name) => page.locator(`#${name}`).inputValue())
				);
				const bodyStyle = await page.evaluate(() => document.body.getAttribute('style'));
				if (fullscreen)
					await activate(page.getByRole('button', { name: 'Fullscreen editor', exact: true }));
				await capture();
				const action = page.getByRole('button', {
					name: `Use selection as ${field === 'title' ? 'Title' : 'Location'}`,
					exact: true
				});
				assert.equal(await page.locator('.selection-actions button').count(), 2);
				assert.equal(
					await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
					true
				);
				if (touch) {
					assert.ok(await action.evaluate((node) => node.getBoundingClientRect().height >= 44));
				}
				if (method === 'keyboard') {
					const tab =
						page.context().browser().browserType().name() === 'webkit' ? 'Alt+Tab' : 'Tab';
					await page.keyboard.press(tab);
					if (field === 'location') await page.keyboard.press(tab);
					assert.equal(await action.evaluate((node) => node === document.activeElement), true);
					await page.keyboard.press('Enter');
				} else await activate(action);
				await page.waitForFunction((field) => document.activeElement?.id === field, field);
				assert.equal(await page.locator(`#${field}`).inputValue(), selected);
				assert.equal(await textarea.inputValue(), text);
				assert.equal(await page.locator('.fullscreen').count(), 0);
				assert.equal(await page.evaluate(() => document.body.getAttribute('style')), bodyStyle);
				for (const [index, name] of ['title', 'start', 'end', 'location'].entries()) {
					if (name !== field)
						assert.equal(await page.locator(`#${name}`).inputValue(), before[index]);
					const label = {
						title: 'Title',
						start: 'Start',
						end: 'End/Duration',
						location: 'Location'
					}[name];
					assert.equal(
						await page.getByRole('switch', { name: `Auto ${label}`, exact: true }).isChecked(),
						name !== field
					);
				}
				await textarea.fill(text.replace('The Hall', 'New Hall'));
				await waitParsed();
				assert.equal(await page.locator(`#${field}`).inputValue(), selected);
				await page
					.getByRole('switch', {
						name: `Auto ${field === 'title' ? 'Title' : 'Location'}`,
						exact: true
					})
					.click();
				assert.equal(
					await page.locator(`#${field}`).inputValue(),
					field === 'title' ? 'Original' : 'New Hall'
				);
			}
		}
	}
	// Both actions reject a cached range whose DOM offsets drift before select fires.
	for (const field of ['Title', 'Location']) {
		await textarea.fill(text);
		await waitParsed();
		await capture();
		await page
			.getByRole('button', { name: `Use selection as ${field}`, exact: true })
			.evaluate((button) => {
				const node = document.querySelector('#description');
				node.setSelectionRange(0, 0);
				button.click();
			});
		assert.equal(
			await page.getByRole('switch', { name: `Auto ${field}`, exact: true }).isChecked(),
			true
		);
	}
	for (const replacement of ['edit', 'reset', 'clipboard']) {
		await textarea.fill(text);
		await waitParsed();
		await capture();
		if (replacement === 'edit') await textarea.fill('Changed Description');
		if (replacement === 'reset')
			await page.getByRole('button', { name: 'Reset', exact: true }).click();
		if (replacement === 'clipboard') {
			await page.evaluate(() =>
				Object.defineProperty(navigator, 'clipboard', {
					configurable: true,
					value: { readText: async () => 'Location: Replacement' }
				})
			);
			await page.getByRole('button', { name: 'Paste from clipboard', exact: true }).click();
		}
		assert.equal(await page.locator('.selection-actions button').count(), 0);
		for (const field of ['Title', 'Location'])
			assert.equal(
				await page.getByRole('switch', { name: `Auto ${field}`, exact: true }).isChecked(),
				true
			);
	}
	await textarea.fill('   ');
	await textarea.evaluate((node) => {
		node.focus();
		node.setSelectionRange(0, 3);
	});
	assert.equal(await page.locator('.selection-actions button').count(), 0);
}

async function checkSelectedTitle(page, engine) {
	const description = '  Selected 한글🙂 title  \nWhen: tomorrow at 7pm';
	const selected = ' Selected 한글🙂 title ';
	await page.locator('#description').fill(description);
	await page.locator('#title').fill('Before selection');
	await page.locator('#start').fill('2026-10-25 19:00');
	await page.locator('#end').fill('4hr');
	const action = page.getByRole('button', { name: 'Use selection as Title', exact: true });
	assert.equal(await action.count(), 0);
	await page.locator('#description').evaluate((node, length) => {
		node.focus();
		node.setSelectionRange(1, 1 + length);
	}, selected.length);
	await action.waitFor();
	assert.equal(await page.locator('#title').inputValue(), 'Before selection');
	// Tab away from the selected textarea text and activate without a mouse.
	await page.keyboard.press(engine === 'webkit' ? 'Alt+Tab' : 'Tab');
	assert.equal(await action.evaluate((node) => node === document.activeElement), true);
	await page.keyboard.press('Space');
	assert.equal(await page.locator('#title').inputValue(), selected);
	assert.equal(await page.locator('#description').inputValue(), description);
	assert.equal(await page.locator('#start').inputValue(), '2026-10-25 19:00');
	assert.equal(await page.locator('#end').inputValue(), '4hr');
	assert.equal(
		await page.locator('#title').evaluate((node) => node === document.activeElement),
		true
	);
	assert.equal(
		await page.getByRole('switch', { name: 'Auto Title', exact: true }).isChecked(),
		false
	);
	await page.locator('#description').fill('Title: Reparsed title\nTomorrow at 8pm');
	await page.waitForFunction(
		() => !document.querySelector('#parse-status').textContent.includes('Parsing current')
	);
	assert.equal(await page.locator('#title').inputValue(), selected);
	await page.locator('#description').evaluate((node) => {
		node.focus();
		node.setSelectionRange(0, 5);
	});
	await action.waitFor();
	await page.locator('#description').fill('');
	assert.equal(await action.count(), 0);
	await page.locator('#description').fill('Old selection');
	await page.locator('#description').evaluate((node) => {
		node.focus();
		node.setSelectionRange(0, 3);
	});
	await action.waitFor();
	await page.getByRole('button', { name: 'Reset', exact: true }).click();
	assert.equal(await action.count(), 0);
	assert.equal(await page.locator('#title').inputValue(), '');
}

async function checkFallbacks(page) {
	const reset = () => page.getByRole('button', { name: 'Reset', exact: true }).click();
	const describe = async (text) => {
		await reset();
		await page.locator('#description').fill(text);
		await page.waitForFunction(
			() => !document.querySelector('#parse-status').textContent.includes('Parsing current')
		);
	};
	const row = (field, part) =>
		page.getByRole('list', { name: `${field} ${part} alternatives`, exact: true });
	const chip = (field, part, label) =>
		row(field, part).getByRole('button', { name: label, exact: true });
	const download = page.getByRole('button', { name: 'Download .ics', exact: true });
	await page.clock.setFixedTime(new Date('2026-10-24T03:00:00Z'));
	await page.setViewportSize({ width: 390, height: 844 });
	await describe('cancel netflix');
	assert.equal(await chip('Start', 'time', 'All day').getAttribute('aria-pressed'), 'true');
	assert.equal(await download.isEnabled(), true);
	assert.equal(await page.locator('#start').inputValue(), 'Tomorrow');
	assert.equal(await chip('Start', 'date', 'Tomorrow').getAttribute('aria-pressed'), 'true');
	for (const label of ['Today', 'Tomorrow', 'In 7 days', 'In 30 days'])
		await chip('Start', 'date', label).waitFor();
	await chip('Start', 'date', 'Tomorrow').focus();
	assert.match(
		await chip('Start', 'date', 'Tomorrow').getAttribute('data-tooltip'),
		/not extracted/
	);
	await page.keyboard.press('Space');
	assert.equal(await download.isEnabled(), true);
	const file = page.waitForEvent('download');
	await download.click();
	const ics = await fs.readFile(await (await file).path(), 'utf8');
	assert.match(ics, /DTSTART;VALUE=DATE:20261025/);
	assert.match(ics, /DTEND;VALUE=DATE:20261026/);
	await chip('Start', 'date', 'In 30 days').click();
	assert.equal(await page.locator('#start').inputValue(), 'In 30 days');
	assert.match(await page.locator('#start-hint').textContent(), /2026-11-23/);
	await chip('Start', 'date', 'Tomorrow').click();
	assert.equal(await page.locator('#start').inputValue(), 'Tomorrow');
	await describe('workout tomorrow');
	assert.match(await page.locator('#start-hint').textContent(), /09:00.*inferred time/);
	for (const label of ['07:00', '09:00', '12:00', '18:00', '19:00'])
		await chip('Start', 'time', label).waitFor();
	await chip('Start', 'time', '18:00').click();
	assert.equal(await page.locator('#end').inputValue(), '2026-10-25 19:00');
	assert.equal(
		await page.getByRole('switch', { name: 'Auto End/Duration', exact: true }).isChecked(),
		true
	);
	const autoEnd = page.getByRole('switch', { name: 'Auto End/Duration', exact: true });
	await autoEnd.uncheck();
	assert.equal(await page.locator('#end').inputValue(), '2026-10-25 19:00');
	await chip('Start', 'time', '12:00').click();
	assert.equal(await page.locator('#end').inputValue(), '2026-10-25 19:00');
	await autoEnd.check();
	assert.equal(await page.locator('#end').inputValue(), '2026-10-25 13:00');
	await chip('Start', 'time', '18:00').click();
	assert.equal(await page.locator('#end').inputValue(), '2026-10-25 19:00');
	assert.equal(await download.isEnabled(), true);
	assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
	await describe('Registration deadline: October 20, 2026\nClass 1: 12:15 - 1:15 pm');
	assert.equal(await chip('Start', 'time', 'All day').getAttribute('aria-pressed'), 'true');
	assert.equal(await download.isEnabled(), true);
	await chip('Start', 'time', '12:15').click();
	await chip('End/Duration', 'time', '13:15').click();
	assert.equal(await download.isEnabled(), true);
	assert.equal(await page.getByText('Not paired in source', { exact: true }).count(), 2);
	await reset();
	await page.setViewportSize({ width: 1280, height: 900 });
}

async function checkLunch(page) {
	await page.locator('#description').fill('lunch tomorrow');
	await page.waitForFunction(
		() => !document.querySelector('#parse-status').textContent.includes('Parsing current')
	);
	assert.equal(await page.locator('#title').inputValue(), 'lunch');
	assert.equal(await page.locator('#start').inputValue(), 'tomorrow');
	assert.match(await page.locator('#start-hint').textContent(), /2026-10-25 12:00 \(Sun, \+1d\)/);
	assert.match(await page.locator('#start-hint').textContent(), /inferred time/);
	assert.match(await page.locator('#end-hint').textContent(), /inferred 60 min/);
	assert.equal(await page.getByText('inferred-time', { exact: true }).count(), 0);
	assert.equal(await page.getByText('assumed-end', { exact: true }).count(), 0);
	const google = page.getByRole('link', { name: 'Open in Google Calendar' });
	assert.equal(
		new URL(await google.getAttribute('href')).searchParams.get('dates'),
		'20261025T030000Z/20261025T040000Z'
	);
	for (const [suffix, expected] of [
		['12p', '12:00'],
		['12a', '00:00']
	]) {
		await page.locator('#description').fill(`lunch tomorrow ${suffix}`);
		await page.waitForFunction(
			() => !document.querySelector('#parse-status').textContent.includes('Parsing current')
		);
		assert.equal(await page.locator('#title').inputValue(), 'lunch');
		assert.match(
			await page.locator('#start-hint').textContent(),
			new RegExp(`2026-10-25 ${expected}`)
		);
	}
	await page.getByRole('button', { name: 'Reset', exact: true }).click();
}

async function checkAllDay(page) {
	await page.locator('#description').fill('lunch tomorrow');
	await page.waitForFunction(
		() => !document.querySelector('#parse-status').textContent.includes('Parsing current')
	);
	await page.setViewportSize({ width: 390, height: 844 });
	const positions = () =>
		page.locator('#start, #end, .event-field .field-controls').evaluateAll((nodes) =>
			nodes.map((node) => {
				const r = node.getBoundingClientRect();
				const group = node.closest('.event-field').getBoundingClientRect();
				return [r.x - group.x, r.y - group.y, r.width, r.height];
			})
		);
	const before = await positions();
	const toggle = page
		.getByRole('list', { name: 'Start time alternatives', exact: true })
		.getByRole('button', { name: 'All day', exact: true });
	assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
	await page.getByRole('button', { name: 'Change time zone', exact: true }).click();
	assert.deepEqual(await positions(), before);
	await page.locator('#zone').fill('America/Argentina/Buenos_Aires');
	await page.waitForFunction(
		() => !document.querySelector('#parse-status').textContent.includes('Parsing current')
	);
	await page.getByRole('button', { name: 'Done', exact: true }).click();
	assert.deepEqual(await positions(), before);
	await page.getByRole('button', { name: 'Change time zone', exact: true }).click();
	await page.getByRole('button', { name: 'Use suggested zone', exact: true }).click();
	await page.waitForFunction(
		() => !document.querySelector('#parse-status').textContent.includes('Parsing current')
	);
	await page.getByRole('button', { name: 'Done', exact: true }).click();

	const start = await page.locator('#start').inputValue(),
		end = await page.locator('#end').inputValue();
	await toggle.click();
	assert.deepEqual(await positions(), before);
	assert.equal(await page.locator('.zone-token').isVisible(), false);
	assert.ok(
		await page.locator('#start').evaluate((input) => {
			const legend = input.closest('fieldset').querySelector('legend');
			return legend.getBoundingClientRect().width < 100;
		})
	);
	assert.equal(
		await page.getByRole('switch', { name: 'Auto Start', exact: true }).isChecked(),
		true
	);
	assert.equal(
		await page.getByRole('switch', { name: 'Auto End/Duration', exact: true }).isChecked(),
		true
	);
	assert.equal(await page.locator('#start').inputValue(), start);
	assert.equal(await page.locator('#end').inputValue(), end);
	assert.match(
		await page.locator('#start-hint').textContent(),
		/2026-10-25 \(Sun, \+1d\).*all day/
	);
	assert.match(await page.locator('#end-hint').textContent(), /2026-10-25.*inclusive end/);
	const google = page.getByRole('link', { name: 'Open in Google Calendar' });
	assert.equal(
		new URL(await google.getAttribute('href')).searchParams.get('dates'),
		'20261025/20261026'
	);
	const pending = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Download .ics', exact: true }).click();
	assert.ok(
		(await fs.readFile(await (await pending).path(), 'utf8')).includes(
			'DTSTART;VALUE=DATE:20261025\r\nDTEND;VALUE=DATE:20261026'
		)
	);
	await toggle.click();
	assert.match(await page.locator('#start-hint').textContent(), /2026-10-25 12:00/);
	await page.locator('#end').fill('4hr');
	await toggle.click();
	assert.equal(await page.locator('#end').inputValue(), '4hr');
	assert.match(await page.locator('#end-hint').textContent(), /2026-10-25.*inclusive end/);
	await toggle.click();
	assert.match(await page.locator('#end-hint').textContent(), /2026-10-25 16:00/);
	await toggle.click();
	await page.locator('#description').fill('lunch day after tomorrow');
	await page.waitForFunction(
		() => !document.querySelector('#parse-status').textContent.includes('Parsing current')
	);
	assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
	assert.match(await page.locator('#start-hint').textContent(), /2026-10-26.*all day/);
	await page.getByRole('button', { name: 'Reset', exact: true }).click();
	assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
}

async function checkSelectOnFocus(page) {
	for (const [id, value] of [
		['title', 'Replace this title'],
		['start', 'tomorrow at 7pm'],
		['end', '4hr'],
		['location', 'Replace this venue']
	]) {
		const input = page.locator(`#${id}`);
		await input.fill(value);
		await page.locator('#description').focus();
		await input.click();
		assert.deepEqual(await input.evaluate((node) => [node.selectionStart, node.selectionEnd]), [
			0,
			value.length
		]);
		await input.click({ position: { x: 12, y: 10 } });
		assert.equal(await input.evaluate((node) => node.selectionStart === node.selectionEnd), true);
		await page.locator('#description').focus();
		await input.focus();
		assert.deepEqual(await input.evaluate((node) => [node.selectionStart, node.selectionEnd]), [
			0,
			value.length
		]);
		await page.keyboard.type('replacement');
		assert.equal(await input.inputValue(), 'replacement');
	}
	await page.getByRole('button', { name: 'Change time zone', exact: true }).click();
	await page.locator('#zone').fill('America/Chicago');
	await page.getByRole('button', { name: 'Done', exact: true }).click();
	await page.getByRole('button', { name: 'Change time zone', exact: true }).click();
	await page.waitForFunction(() => {
		const input = document.querySelector('#zone');
		return input.selectionEnd === input.value.length;
	});
	assert.deepEqual(
		await page.locator('#zone').evaluate((node) => [node.selectionStart, node.selectionEnd]),
		[0, 'America/Chicago'.length]
	);
	assert.equal(await page.getByRole('dialog', { name: 'Choose time zone' }).isVisible(), true);
	await page.keyboard.press('Escape');
	await page.waitForFunction(() => document.activeElement?.matches('.zone-token'));
	assert.equal(await page.getByRole('dialog').isVisible(), false);
	assert.equal(
		await page
			.getByRole('button', { name: 'Change time zone' })
			.evaluate((node) => node === document.activeElement),
		true
	);
	await page.getByRole('button', { name: 'Reset', exact: true }).click();
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
	page.on('dialog', async (dialog) => {
		errors.push('Unexpected confirmation dialog');
		await dialog.dismiss();
	});
	await page.goto(process.env.NL_EVENT_BASE_URL || 'http://localhost:5173/');
	await page.locator('#description').waitFor();
	await page.waitForFunction(() => !document.querySelector('#description').disabled);
	assert.deepEqual(
		await page
			.locator('textarea:visible, input[type=text]:visible')
			.evaluateAll((nodes) => nodes.map((n) => n.id)),
		['description', 'title', 'start', 'end', 'location']
	);
	assert.equal(
		await page.getByRole('button', { name: 'Download .ics', exact: true }).isDisabled(),
		true
	);
	assert.equal(await page.locator('#start-error, #end-error').count(), 0);
	assert.equal(await page.locator('#start[aria-invalid=true], #end[aria-invalid=true]').count(), 0);
	assert.equal(
		await page.locator('#start-hint').textContent(),
		'Try tomorrow at 7pm, or a date for all-day'
	);
	await page.locator('#start').fill('invalid time');
	await page.locator('#start-error').waitFor();
	assert.equal(await page.locator('#end-error').count(), 0);
	await page.locator('#start').fill('');
	assert.equal(await page.locator('#start-error, #end-error').count(), 0);
	await page.locator('#description').fill('An event without a date');
	await page.locator('#end-error').waitFor();
	await page.getByRole('button', { name: 'Reset', exact: true }).click();
	assert.equal(await page.locator('#start-error, #end-error').count(), 0);
	await checkDescriptionEditor(page);
	await checkPendingClipboard(page);
	await checkCandidates(page);
	await checkEnglishDates(page);
	await checkSlowSaturday(page);
	await checkRhythmParty(page);
	await checkOctoberMidnight(page);
	await checkTemporalParts(page);
	await checkDurations(page);
	await checkFreeform(page);
	await checkSelectedTitle(page, name);
	await checkMapLocations(page);
	await checkSelectionActions(page);
	await checkSelectOnFocus(page);
	await checkLunch(page);
	await checkFallbacks(page);
	await page.locator('#description').fill('unsubscribe netflix in 30 days');
	await page.waitForFunction(
		() => !document.querySelector('#parse-status').textContent.includes('Parsing current')
	);
	assert.equal(await page.locator('#title').inputValue(), 'unsubscribe netflix');
	assert.equal(
		await page
			.getByRole('list', { name: 'Start time alternatives', exact: true })
			.getByRole('button', { name: 'All day', exact: true })
			.getAttribute('aria-pressed'),
		'true'
	);
	assert.match(
		await page.locator('#start-hint').textContent(),
		/2026-11-23 \(Mon, \+30d\).*all day/
	);
	assert.equal(
		new URL(
			await page.getByRole('link', { name: 'Open in Google Calendar' }).getAttribute('href')
		).searchParams.get('dates'),
		'20261123/20261124'
	);
	const textareaBox = await page.locator('#description').boundingBox();
	const resetBox = await page.getByRole('button', { name: 'Reset', exact: true }).boundingBox();
	assert.ok(resetBox.y + resetBox.height <= textareaBox.y);
	const descriptionLabelBox = await page.locator('label[for=description]').boundingBox();
	assert.ok(
		Math.abs(
			resetBox.y + resetBox.height / 2 - descriptionLabelBox.y - descriptionLabelBox.height / 2
		) < 1
	);
	const actionBox = await page.locator('.description-actions').boundingBox();
	assert.ok(Math.abs(actionBox.x + actionBox.width - textareaBox.x - textareaBox.width) < 2);
	await page.getByRole('button', { name: 'Reset', exact: true }).click();

	await checkAllDay(page);
	// A clipboard paste shows source phrases while preview/export retain context.
	await page.evaluate(() =>
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: { readText: async () => 'November 14th, 2026, 8 pm - midnight\nLocation: St Paul, MN' }
		})
	);
	await page.getByRole('button', { name: 'Paste from clipboard', exact: true }).click();
	await page.getByRole('list', { name: 'Start date alternatives', exact: true }).waitFor();
	assert.equal(await page.locator('#start').inputValue(), 'November 14th, 2026, 8 pm');
	assert.equal(await page.locator('#end').inputValue(), 'November 14th, 2026, 8 pm - midnight');
	assert.match(await page.locator('#start-hint').textContent(), /2026-11-14 20:00 \(Sat, \+22d\)/);
	assert.match(await page.locator('#end-hint').textContent(), /2026-11-15 00:00 \(Sun, \+23d\)/);
	assert.equal(await page.locator('.zone-token').textContent(), 'America/Chicago');
	await page.getByRole('button', { name: 'Reset', exact: true }).click();

	await page.locator('#description').fill('  Original 한글🙂\nDescription; comma, slash\\  \n');
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
	assert.ok(
		first
			.replace(/\r\n /g, '')
			.includes('DESCRIPTION:  Original 한글🙂\\nDescription\\; comma\\, slash\\\\  \\n\r\n')
	);
	await page.locator('#title').fill('Edited title');
	assert.equal(uid(await download()), uid(first));
	await page.getByRole('switch', { name: 'Auto Title', exact: true }).click();
	assert.equal(await page.locator('#title').inputValue(), 'Original 한글🙂');
	assert.equal(uid(await download()), uid(first));
	await page.locator('#description').fill('');
	assert.equal(await page.locator('#start').inputValue(), '2026-10-25 17:00');
	await page.getByRole('button', { name: 'Reset', exact: true }).click();
	assert.equal(await page.locator('#start').inputValue(), '');
	await page.locator('#start').fill('2026-10-25 17:00');
	await page.locator('#end').fill('2026-10-25 18:00');
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
	await page.getByRole('button', { name: 'Paste from clipboard', exact: true }).click();
	assert.equal(await page.locator('#description').inputValue(), 'replacement text');
	await page.waitForFunction(
		() => !document.querySelector('#parse-status').textContent.includes('Parsing current')
	);
	assert.equal(await page.locator('#start').inputValue(), 'Tomorrow');
	await page.locator('#start').fill('2026-10-25');
	await page.locator('#end').fill('2026-10-26');
	assert.notEqual(uid(await download()), uid(first));
	assert.equal(
		new URL(await google.getAttribute('href')).searchParams.get('dates'),
		'20261025/20261027'
	);
	assert.equal(
		await page.getByRole('button', { name: 'Change time zone', exact: true }).count(),
		0
	);
	await page
		.getByRole('list', { name: 'Start time alternatives', exact: true })
		.getByRole('button', { name: 'All day', exact: true })
		.click();
	await page.getByRole('button', { name: 'Change time zone', exact: true }).click();
	await page.locator('#zone').fill('America/Chicago');
	await page.getByRole('button', { name: 'Done', exact: true }).click();
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
	// Settle scrolling before focus, since scrolling dismisses tooltips.
	const resetStart = page.getByRole('switch', { name: 'Auto Start', exact: true });
	await resetStart.evaluate(async (node) => {
		node.scrollIntoView({ block: 'center' });
		await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
	});
	await page.locator('#start').focus();
	// WebKit on macOS uses Option+Tab to include form controls in keyboard navigation.
	await page.keyboard.press(name === 'webkit' ? 'Alt+Shift+Tab' : 'Shift+Tab');
	await page.getByRole('tooltip').waitFor({ timeout: 750 });
	assert.match(await resetStart.getAttribute('aria-describedby'), /field-tooltip/);
	assert.equal(await resetStart.evaluate((node) => node === document.activeElement), true);
	assert.equal(
		await resetStart.evaluate((node) => {
			const style = getComputedStyle(node);
			return style.boxShadow !== 'none' || style.outlineStyle !== 'none';
		}),
		true
	);
	await page.keyboard.press('Space');
	assert.equal(await page.locator('#start').inputValue(), 'Tomorrow');
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
		const rowAlignment = await page.locator('.event-field').evaluateAll((groups) =>
			groups.map((group) => {
				const label = group.querySelector('legend').getBoundingClientRect();
				const controls = group.querySelector('.field-controls').getBoundingClientRect();
				return [
					label.y + label.height / 2,
					controls.y + controls.height / 2,
					label.right,
					controls.left
				];
			})
		);
		assert.ok(
			rowAlignment.every(([a, b, right, left]) => Math.abs(a - b) < 2 && left - right >= 4),
			JSON.stringify(rowAlignment)
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
	await page.getByRole('button', { name: 'Reset', exact: true }).click();
	assert.equal(await page.locator('#description').inputValue(), '');
	assert.equal(await page.locator('#zone').isVisible(), false);
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
	await touchPage.locator('#description').focus();
	await touchPage.locator('#title').tap();
	assert.deepEqual(
		await touchPage.locator('#title').evaluate((node) => [node.selectionStart, node.selectionEnd]),
		[0, 'Touch target check'.length]
	);
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
	assert.ok(
		await touchPage
			.locator('label.ownership')
			.evaluateAll((nodes) => nodes.every((node) => node.getBoundingClientRect().height >= 44))
	);
	await touchPage.getByRole('button', { name: 'Done', exact: true }).tap();
	await touchPage.getByRole('switch', { name: 'Auto Title', exact: true }).tap();
	assert.equal(await touchPage.locator('#title').inputValue(), '');
	await touchPage.screenshot({
		path: path.join(os.tmpdir(), `nl-event-${name}-touch.png`),
		fullPage: true
	});
	await touchPage.getByRole('button', { name: 'Reset', exact: true }).tap();
	await touchPage.locator('#description').fill('cancel netflix next month');
	await touchPage.getByText(/day unresolved/).waitFor();
	assert.equal(await touchPage.locator('#start').inputValue(), '');
	assert.equal(
		await touchPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
		true
	);
	assert.equal(
		await touchPage.getByRole('button', { name: 'Download .ics', exact: true }).isDisabled(),
		true
	);
	await touchPage.screenshot({
		path: path.join(os.tmpdir(), `nl-event-english-${name}-touch.png`),
		fullPage: true
	});
	await checkDescriptionEditor(touchPage, { touch: true });
	await checkSelectionActions(touchPage, { touch: true });
	await touchContext.close();
	assert.deepEqual(errors, []);
	console.log(
		`${name}: PASS - hydration, five fields, Google query, real ICS downloads, UID reuse/reset, 14 parsing fixtures, sanitized October short-year/prices/midnight with four-hour Google/ICS parity, per-field candidates, partial resolution, debounce/new-draft invalidation, ownership/reset, address-first Google/ICS locations, selected-text Title and Location, freeform input/interpretations and export parity, no confirmation dialogs, clipboard failure/empty/replace and pending-read races, all-day bounds, zone/DST choices/gaps, desktop/390px layout, compact inline actions, keyboard focus/activation, coarse-pointer touch targets, expanding editor height/cap, native Enter/undo/redo, Chromium IME, fullscreen identity/selection/Escape, wrap/counts, orientation and touch selection; no page errors`
	);
	await browser.close();
}
