import ts from 'typescript';

const functions = {
	'EventCore.res.js': [
		'validate',
		'validateBase',
		'durationValue',
		'durationOptions',
		'temporalParts',
		'temporalCandidates',
		'temporalOptions'
	],
	'TimeInput.res.js': ['interpret'],
	'Parser.res.js': ['parse'],
	'descriptionEditor.ts': ['paintEvidence', 'syncEvidence', 'hoverText', 'revealEvidence', 'update']
};

/** Only the explicitly enabled dev server transforms source; release builds are untouched.
 * @returns {import('vite').Plugin}
 */
export function editorProfilePlugin() {
	return {
		name: 'editor-projection-profile',
		apply: 'serve',
		enforce: 'pre',
		transform(source, id) {
			if (process.env.NL_EVENT_EDITOR_PROFILE !== '1' || id.includes('?')) return;
			const filename = id.split('/').at(-1);
			if (filename === '+page.svelte' && id.endsWith('/src/routes/+page.svelte')) {
				const calls = [
					['validation', 'Core.validate(draft)'],
					['highlights', 'Core.temporalOptions(draft, name, part)'],
					['labels', 'Core.temporalOptions(draft, name, part as Core.temporalPart)'],
					['durationValue', 'Core.durationValue(draft)'],
					['durationOptions', 'Core.durationOptions(draft)']
				];
				// The two typed temporal call sites have identical expressions, in document order.
				let temporalSite = 0;
				source = source.replaceAll(
					'Core.temporalOptions(draft, name, part as Core.temporalPart)',
					(call) =>
						`__profile.measure('projection.${temporalSite++ === 0 ? 'labels' : 'chips'}', () => ${call})`
				);
				if (temporalSite !== 2) throw new Error('Profiling temporal call sites changed');
				for (const [site, call] of calls.filter(([site]) => site !== 'labels')) {
					if (source.split(call).length !== 2)
						throw new Error(`Profiling call site changed: ${site}`);
					source = source.replace(call, `__profile.measure('projection.${site}', () => ${call})`);
				}
				return source.replace('<script lang="ts">', `<script lang="ts">\n${fallback}`);
			}
			const names = functions[filename];
			if (!names || !id.includes('/src/lib/')) return;
			const ast = ts.createSourceFile(id, source, ts.ScriptTarget.Latest, true);
			const edits = [];
			const found = new Set();
			const wrap = (node, name) => {
				edits.push([node.getStart(ast), `__profile.measure(${JSON.stringify(name)}, () => (`]);
				edits.push([node.end, '))']);
			};
			const visit = (node) => {
				if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text) && node.body) {
					const name = node.name.text;
					found.add(name);
					const size =
						filename === 'descriptionEditor.ts'
							? name === 'update'
								? 'next.value.length'
								: 'options.value.length'
							: filename === 'EventCore.res.js'
								? 'undefined'
								: `${node.parameters[0].name.getText(ast)}.length`;
					edits.push([
						node.body.getStart(ast) + 1,
						`const __span = __profile.begin('${filename}:${name}', ${size}); try {`
					]);
					edits.push([node.body.end - 1, '} finally { __profile.end(__span); }']);
				}
				if (filename === 'descriptionEditor.ts' && ts.isCallExpression(node)) {
					const callee = node.expression.getText(ast);
					if (callee === 'styledEvidenceSegments') wrap(node, 'mirror.segment');
					if (callee === 'content.replaceChildren')
						wrap(node, 'mirror.replaceChildren+nodes+segments');
					if (
						callee.endsWith('.map') &&
						node.expression.getText(ast).startsWith('styledEvidenceSegments')
					)
						wrap(node, 'mirror.nodes+segments');
					if (callee === 'requestAnimationFrame') {
						const body = node.arguments[0].body;
						if (!ts.isBlock(body))
							throw new Error('Profiling frame callback must have a block body');
						edits.push([
							body.getStart(ast) + 1,
							"const __span = __profile.begin('mirror.measureFrame', options.value.length); try {"
						]);
						edits.push([body.end - 1, '} finally { __profile.end(__span); }']);
					}
				}
				ts.forEachChild(node, visit);
			};
			visit(ast);
			for (const name of names)
				if (!found.has(name)) throw new Error(`Profiling function missing: ${filename}:${name}`);
			// At a shared start, insert the inner prefix first so the outer prefix remains outside.
			for (const [offset, text] of edits
				.map((edit, index) => [...edit, index])
				.sort((a, b) => b[0] - a[0] || b[2] - a[2]))
				source = source.slice(0, offset) + text + source.slice(offset);
			return { code: fallback + source, map: null };
		}
	};
}

const fallback = `const __profile = globalThis.__nlEventProfile ?? { begin: () => undefined, end: () => {}, measure: (_name, run) => run() };\n`;
