import assert from 'node:assert/strict';

export async function checkAnnouncementLinks(page, touch = false) {
	const activate = (node) => (touch ? node.tap() : node.click());
	const description = page.locator('#description');
	const chips = page.getByRole('group', { name: 'Description links', exact: true });
	const details = page.getByRole('region', { name: 'Link details', exact: true });
	const source =
		'Synthetic event\nSignup: https://forms.gle/SYNTHETIC_SIGNUP\nConfirmation: https://docs.google.com/spreadsheets/d/SYNTHETIC_SHEET/edit\nMap: https://map.naver.com/p/example\nInfo: https://example.com/info';
	const requests = [];
	const external = [];
	const onRequest = (request) => {
		if (new URL(request.url()).origin !== new URL(page.url()).origin) external.push(request.url());
	};
	const routeHandler = async (route) => {
		requests.push(route.request().url());
		await route.fulfill({
			contentType: 'application/json',
			body: JSON.stringify({
				status: 'ok',
				type: 'form',
				documentId: 'f.SYNTHETIC',
				title: 'Form title',
				infoText: 'Intro',
				autoSheets: [],
				autoSheetsStatus: 'complete'
			})
		});
	};
	page.on('request', onRequest);
	await page.route('**/api/form-meta?*', routeHandler);
	try {
		await activate(page.getByRole('button', { name: 'Reset', exact: true }));
		assert.equal(await chips.count(), 0);
		await description.fill(source);
		assert.equal(await chips.getByRole('button').count(), 4);
		assert.equal(
			await page.locator('fieldset.description-editor legend').textContent(),
			'Description'
		);
		assert.equal(await page.locator('[popover]').count(), 0);
		const signup = chips.getByRole('button', {
			name: 'Details for https://forms.gle/SYNTHETIC_SIGNUP',
			exact: true
		});
		if (!touch) {
			await signup.hover();
			await page.waitForFunction(() =>
				[...document.querySelectorAll('.description-evidence mark[data-hovered=true]')].some(
					(mark) => mark.textContent === 'https://forms.gle/SYNTHETIC_SIGNUP'
				)
			);
		}
		assert.equal(requests.length, 0);
		await activate(
			chips.getByRole('button', {
				name: 'Details for https://map.naver.com/p/example',
				exact: true
			})
		);
		assert.equal(
			await details
				.getByRole('link', { name: 'https://map.naver.com/p/example', exact: true })
				.getAttribute('href'),
			'https://map.naver.com/p/example'
		);
		assert.equal(await details.getByLabel('Veneer link', { exact: true }).count(), 0);
		assert.equal(requests.length, 0);
		await activate(
			chips.getByRole('button', { name: 'Details for https://example.com/info', exact: true })
		);
		assert.equal(await details.count(), 1);
		assert.equal(
			await details
				.getByRole('link', { name: 'https://example.com/info', exact: true })
				.getAttribute('href'),
			'https://example.com/info'
		);
		await activate(signup);
		await details.getByRole('button', { name: 'Add to description', exact: true }).waitFor();
		assert.equal(requests.length, 1);
		assert.equal(await description.inputValue(), source);
		await activate(details.getByLabel('Veneer link', { exact: true }));
		assert.equal(await chips.getByRole('button').count(), 4);
		assert.ok(
			(await description.inputValue()).startsWith(
				'https://veneer.leftium.com/g.SYNTHETIC_SIGNUP\n\n---\n\n'
			)
		);
		await page.waitForFunction(() => document.querySelector('#title').value === 'Synthetic event');
		await activate(details.getByLabel('Veneer link', { exact: true }));
		assert.equal(await description.inputValue(), source);
		await page.keyboard.press('Escape');
		await details.waitFor({ state: 'hidden' });
		assert.equal(await signup.evaluate((node) => document.activeElement === node), true);
		await activate(page.getByRole('button', { name: 'Fullscreen editor', exact: true }));
		await activate(
			chips.getByRole('button', {
				name: 'Details for https://map.naver.com/p/example',
				exact: true
			})
		);
		await page.keyboard.press('Escape');
		assert.equal(await page.locator('.description-editor.fullscreen').count(), 1);
		await activate(page.getByRole('button', { name: 'Restore editor', exact: true }));
		await description.fill(
			'https://docs.google.com/forms/d/e/SYNTHETIC_FORM/viewform\nhttps://veneer.leftium.com/f.SYNTHETIC_FORM'
		);
		assert.equal(await chips.getByRole('button').count(), 1);
		await activate(chips.getByRole('button'));
		await activate(details.getByText('Equivalent links (1)', { exact: true }));
		await details
			.getByRole('link', { name: 'https://veneer.leftium.com/f.SYNTHETIC_FORM', exact: true })
			.waitFor();
		await activate(page.getByRole('button', { name: 'Fullscreen editor', exact: true }));
		await details
			.getByRole('link', { name: 'https://veneer.leftium.com/f.SYNTHETIC_FORM', exact: true })
			.focus();
		await page.keyboard.press('Tab');
		assert.equal(
			await page
				.getByRole('button', { name: 'Reset', exact: true })
				.evaluate((node) => node === document.activeElement),
			true
		);
		await activate(page.getByRole('button', { name: 'Restore editor', exact: true }));
		assert.equal(
			await details
				.getByRole('link', { name: 'https://veneer.leftium.com/f.SYNTHETIC_FORM', exact: true })
				.count(),
			1
		);
		await activate(page.getByRole('button', { name: 'Reset', exact: true }));
		assert.equal(await chips.count(), 0);
		assert.equal(await details.count(), 0);
		assert.deepEqual(external, []);
	} finally {
		page.off('request', onRequest);
		await page.unroute('**/api/form-meta?*', routeHandler);
	}
}
