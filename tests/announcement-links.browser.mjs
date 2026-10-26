import assert from 'node:assert/strict';

export async function checkAnnouncementLinks(page, touch = false) {
	const activate = (locator) => (touch ? locator.tap() : locator.click());
	const description = page.locator('#description');
	const trigger = page.getByRole('button', { name: /^Links \(/ });
	const dialog = page.getByRole('dialog', { name: 'Description links', exact: true });
	const source = [
		'신청: https://forms.gle/SYNTHETIC_SIGNUP',
		'확인: https://docs.google.com/spreadsheets/d/SYNTHETIC_SHEET/edit',
		'장소: https://map.naver.com/p/example',
		'Info: https://example.com/info'
	].join('\n');
	const external = [];
	const onRequest = (request) => {
		if (new URL(request.url()).origin !== new URL(page.url()).origin) external.push(request.url());
	};
	page.on('request', onRequest);
	try {
		await activate(page.getByRole('button', { name: 'Reset', exact: true }));
		assert.equal(await trigger.count(), 0);
		await description.fill(source);
		await description.evaluate((node) => node.setSelectionRange(3, 12, 'backward'));
		assert.equal(await trigger.textContent(), 'Links (4)');
		assert.equal(
			await page
				.locator('.description-heading .description-actions')
				.getByRole('button', { name: 'Links (4)', exact: true })
				.count(),
			1
		);
		await activate(trigger);
		await dialog.waitFor({ state: 'visible' });
		assert.equal(
			await dialog.getByRole('radio', { name: 'Primary signup', exact: true }).isChecked(),
			true
		);
		assert.equal(await dialog.getByRole('heading', { name: 'Map', exact: true }).count(), 1);
		assert.equal(await dialog.getByRole('heading', { name: 'Other', exact: true }).count(), 1);
		assert.match(await dialog.textContent(), /Confirmation fallback candidate/);
		await activate(dialog.getByRole('button', { name: 'Close', exact: true }));
		assert.equal(await trigger.evaluate((node) => node === document.activeElement), true);
		assert.deepEqual(
			await description.evaluate((node) => [
				node.selectionStart,
				node.selectionEnd,
				node.selectionDirection
			]),
			[3, 12, 'backward']
		);
		assert.equal(await description.inputValue(), source);
		await activate(trigger);
		if (touch) await page.touchscreen.tap(2, 2);
		else await page.mouse.click(2, 2);
		await dialog.waitFor({ state: 'hidden' });
		assert.equal(await trigger.evaluate((node) => node === document.activeElement), true);
		await activate(page.getByRole('button', { name: 'Fullscreen editor', exact: true }));
		await activate(trigger);
		await page.keyboard.press('Shift+Tab');
		assert.equal(await dialog.evaluate((node) => node.contains(document.activeElement)), true);
		await page.keyboard.press('Tab');
		assert.equal(await dialog.evaluate((node) => node.contains(document.activeElement)), true);
		await page.keyboard.press('Escape');
		await dialog.waitFor({ state: 'hidden' });
		assert.equal(await page.locator('.description-editor.fullscreen').count(), 1);
		assert.equal(await trigger.evaluate((node) => node === document.activeElement), true);
		await activate(page.getByRole('button', { name: 'Restore editor', exact: true }));
		await description.fill('https://forms.gle/FIRST_SYNTHETIC\nhttps://forms.gle/SECOND_SYNTHETIC');
		await activate(trigger);
		assert.equal(
			await dialog.getByRole('radio', { name: 'None selected', exact: true }).isChecked(),
			true
		);
		await activate(dialog.getByRole('radio', { name: 'Use as signup', exact: true }).nth(1));
		await activate(dialog.getByRole('button', { name: 'Close', exact: true }));
		await description.fill('https://forms.gle/SECOND_SYNTHETIC\nhttps://forms.gle/FIRST_SYNTHETIC');
		await activate(trigger);
		assert.match(
			await dialog
				.locator('li')
				.filter({ has: page.getByRole('radio', { name: 'Primary signup', exact: true }) })
				.textContent(),
			/SECOND_SYNTHETIC/
		);
		await activate(dialog.getByRole('button', { name: 'Close', exact: true }));
		await description.fill('https://example.com/replacement');
		await activate(trigger);
		assert.equal(
			await dialog.getByRole('radio', { name: 'None selected', exact: true }).isChecked(),
			true
		);
		await activate(dialog.getByRole('button', { name: 'Close', exact: true }));
		await page.evaluate(() => {
			Object.defineProperty(navigator, 'clipboard', {
				configurable: true,
				value: { readText: async () => 'https://url.kr/SYNTHETIC_CLIPBOARD' }
			});
		});
		await activate(page.getByRole('button', { name: 'Paste from clipboard', exact: true }));
		await page.waitForFunction(() =>
			document.querySelector('#description').value.includes('SYNTHETIC_CLIPBOARD')
		);
		await activate(trigger);
		assert.match(await dialog.textContent(), /Destination unknown/);
		assert.equal(
			await dialog.getByRole('radio', { name: 'None selected', exact: true }).isChecked(),
			true
		);
		await activate(dialog.getByRole('button', { name: 'Close', exact: true }));
		await activate(page.getByRole('button', { name: 'Reset', exact: true }));
		assert.equal(await trigger.count(), 0);
		assert.deepEqual(external, []);
	} finally {
		page.off('request', onRequest);
		await page.evaluate(() => {
			delete navigator.clipboard;
		});
	}
}
