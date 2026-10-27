import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { selectBrowserEngines } from '../scripts/browser-engines.mjs';

test('default and explicit full selection preserve engine order', () => {
	const env = { ...process.env };
	delete env.NL_EVENT_BROWSER_ENGINE;
	const result = spawnSync(
		process.execPath,
		[
			'--input-type=module',
			'-e',
			"import { selectBrowserEngines } from './scripts/browser-engines.mjs'; console.log(JSON.stringify(selectBrowserEngines()))"
		],
		{ env, encoding: 'utf8' }
	);
	assert.equal(result.status, 0);
	assert.deepEqual(JSON.parse(result.stdout), ['chromium', 'webkit']);
	assert.deepEqual(selectBrowserEngines('both'), ['chromium', 'webkit']);
});

test('each engine can be selected without the other', () => {
	for (const engine of ['chromium', 'webkit']) {
		assert.deepEqual(selectBrowserEngines(engine), [engine]);
	}
});

test('invalid selectors fail in both entry points before server or compiler work', () => {
	for (const selection of ['', 'firefox', 'Chromium', 'chromium,webkit', ' chromium']) {
		assert.throws(() => selectBrowserEngines(selection), /Invalid NL_EVENT_BROWSER_ENGINE/);
		for (const entry of ['tests/browser-smoke.mjs', 'scripts/profile-browser.mjs']) {
			const result = spawnSync(process.execPath, [entry], {
				env: { ...process.env, NL_EVENT_BROWSER_ENGINE: selection },
				encoding: 'utf8'
			});
			assert.notEqual(result.status, 0);
			assert.match(result.stderr, /Invalid NL_EVENT_BROWSER_ENGINE/);
		}
	}
});
