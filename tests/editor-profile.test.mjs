import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { installEditorProfile } from './editor-profile-runtime.mjs';
import { editorProfilePlugin } from '../scripts/editor-profile-plugin.mjs';

test('nested costs, return values, throwing calls, disabled mode and clock binding', () => {
	let clock = 0;
	const context = vm.createContext({ performance: { now: () => clock } });
	vm.runInContext(`(${installEditorProfile.toString()})()`, context);
	const profile = context.__nlEventProfile;
	profile.start('edit');
	context.performance.now = () => -999;
	assert.equal(profile.now(), 0);
	const result = profile.measure('outer', () => {
		clock += 2;
		profile.measure('child', () => {
			clock += 3;
		});
		clock += 1;
		return 42;
	});
	assert.equal(result, 42);
	const { rows, dropped } = profile.stop();
	assert.equal(dropped, 0);
	assert.equal(rows[0].parent, 'outer');
	assert.equal(rows[0].ms, 3);
	assert.equal(rows[1].ms, 6);
	assert.equal(rows[1].selfMs, 3);
	profile.start('throw');
	const error = new Error('original');
	assert.throws(
		() =>
			profile.measure('throws', () => {
				throw error;
			}),
		(actual) => actual === error
	);
	assert.equal(profile.stop().rows.length, 1);
	profile.start('control', false);
	assert.equal(
		profile.measure('disabled', () => 17),
		17
	);
	assert.equal(profile.stop().rows.length, 0);
});

test('profiling transform is absent by default and from build configuration', () => {
	const before = process.env.NL_EVENT_EDITOR_PROFILE;
	delete process.env.NL_EVENT_EDITOR_PROFILE;
	try {
		const plugin = editorProfilePlugin();
		assert.equal(plugin.apply, 'serve');
		assert.equal(plugin.transform('unchanged', '/src/lib/descriptionEditor.ts'), undefined);
	} finally {
		if (before === undefined) delete process.env.NL_EVENT_EDITOR_PROFILE;
		else process.env.NL_EVENT_EDITOR_PROFILE = before;
	}
});

test('transform preserves segmentation, node creation and replacement nesting', () => {
	const before = process.env.NL_EVENT_EDITOR_PROFILE;
	process.env.NL_EVENT_EDITOR_PROFILE = '1';
	try {
		const source = `
			function paintEvidence() { content.replaceChildren(...styledEvidenceSegments(options.value, []).map(segment => document.createTextNode(segment.text))); }
			function syncEvidence() {}
			function hoverText() {}
			function revealEvidence() {}
			function update(next) { options.value = next.value; requestAnimationFrame(() => { syncEvidence(); }); }
		`;
		const context = vm.createContext({
			performance: { now: () => performance.now() },
			options: { value: 'abc' },
			styledEvidenceSegments: (value) => [{ text: value }],
			document: { createTextNode: (text) => ({ text }), addEventListener() {} },
			content: {
				replaceChildren: (...nodes) => {
					assert.equal(nodes[0].text, 'abc');
				}
			}
		});
		vm.runInContext(`(${installEditorProfile.toString()})()`, context);
		const transformed = editorProfilePlugin().transform(source, '/src/lib/descriptionEditor.ts');
		vm.runInContext(transformed.code, context);
		context.__nlEventProfile.start('paint');
		vm.runInContext('paintEvidence()', context);
		const { rows } = context.__nlEventProfile.stop();
		assert.equal(rows.find((row) => row.name === 'mirror.segment').parent, 'mirror.nodes+segments');
		assert.equal(
			rows.find((row) => row.name === 'mirror.nodes+segments').parent,
			'mirror.replaceChildren+nodes+segments'
		);
		assert.equal(
			rows.find((row) => row.name === 'mirror.replaceChildren+nodes+segments').parent,
			'descriptionEditor.ts:paintEvidence'
		);
		context.requestAnimationFrame = () => {};
		context.__nlEventProfile.start('update');
		vm.runInContext('update({value: "longer value"})', context);
		assert.equal(context.__nlEventProfile.stop().rows[0].size, 'longer value'.length);
	} finally {
		if (before === undefined) delete process.env.NL_EVENT_EDITOR_PROFILE;
		else process.env.NL_EVENT_EDITOR_PROFILE = before;
	}
});
