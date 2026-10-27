/** Installed before application code and any test clock; spans contain no source text. */
export function installEditorProfile() {
	const now = performance.now.bind(performance);
	const stack = [];
	let rows = [];
	let active = false;
	let dropped = 0;
	let stage = 'startup';
	let inputEvents = [];
	let recording = false;
	globalThis.document?.addEventListener(
		'input',
		(event) => {
			if (
				recording &&
				['description', 'title', 'start', 'end', 'location'].includes(event.target.id)
			) {
				inputEvents.push({
					target: event.target.id,
					inputType: event.inputType ?? '',
					size: event.target.value.length
				});
			}
		},
		true
	);
	const profile = {
		now,
		begin(name, size) {
			if (!active) return;
			const frame = {
				name,
				size,
				stage,
				parent: stack.at(-1)?.name ?? null,
				children: 0,
				start: now()
			};
			stack.push(frame);
			return frame;
		},
		end(frame) {
			if (!frame) return;
			const elapsed = now() - frame.start;
			if (stack.pop() !== frame) throw new Error('Unbalanced editor profile');
			if (stack.length) stack.at(-1).children += elapsed;
			if (rows.length < 100000)
				rows.push({
					name: frame.name,
					size: frame.size,
					stage: frame.stage,
					parent: frame.parent,
					ms: elapsed,
					selfMs: elapsed - frame.children
				});
			else dropped++;
		},
		measure(name, run) {
			const frame = profile.begin(name);
			try {
				return run();
			} finally {
				profile.end(frame);
			}
		},
		start(label, enabled = true) {
			if (stack.length) throw new Error('Cannot reset an active profile span');
			rows = [];
			inputEvents = [];
			recording = true;
			dropped = 0;
			stage = label;
			active = enabled;
		},
		stop() {
			if (stack.length) throw new Error('Unfinished editor profile span');
			active = false;
			recording = false;
			return { rows, dropped, inputEvents };
		}
	};
	globalThis.__nlEventProfile = profile;
}
