import { AsyncLocalStorage } from 'node:async_hooks';
import { appendFileSync } from 'node:fs';

// Node-only instrumentation. Normal runs install no hooks and read no clocks.
export const profile = process.env.NL_EVENT_PROFILE_FILE ? createProfile() : undefined;
export const measure = (name, run, category = 'scenario') =>
	profile ? profile.measure(name, run, category) : run();

function createProfile() {
	const file = process.env.NL_EVENT_PROFILE_FILE;
	const origin = BigInt(process.env.NL_EVENT_PROFILE_ORIGIN_NS);
	const storage = new AsyncLocalStorage();
	const open = new Map();
	const instrumented = new WeakSet();
	let sequence = 0;
	const now = () => Number(process.hrtime.bigint() - origin) / 1e6;
	const emit = (record) => appendFileSync(file, JSON.stringify(record) + '\n');
	const errorDetails = (error) => ({
		name: error?.name,
		message: error?.message,
		stack: error?.stack
	});
	function start(name, category) {
		const span = {
			id: `browser-${++sequence}`,
			parentId: storage.getStore()?.id ?? 'runner',
			name,
			category,
			startMs: now()
		};
		open.set(span.id, span);
		emit({ type: 'start', ...span });
		return span;
	}
	function finish(span, status = 'passed', error) {
		if (!open.delete(span.id)) return;
		const endMs = now();
		emit({
			type: 'span',
			...span,
			endMs,
			durationMs: endMs - span.startMs,
			status,
			...(error ? { error: errorDetails(error) } : {})
		});
	}
	async function measured(name, run, category) {
		const span = start(name, category);
		return storage.run(span, async () => {
			try {
				const value = await run();
				finish(span);
				return value;
			} catch (error) {
				finish(span, 'failed', error);
				throw error;
			}
		});
	}
	function wrap(target, method, category, label = () => method, after) {
		const original = target[method];
		target[method] = function (...args) {
			return measured(label(args, this), () => original.apply(this, args), category).then(
				(value) => {
					after?.(value);
					return value;
				}
			);
		};
	}
	function instrumentPage(page) {
		if (instrumented.has(page)) return;
		instrumented.add(page);
		wrap(page, 'goto', 'navigation');
		wrap(page, 'screenshot', 'screenshot');
		wrap(page, 'waitForTimeout', 'wait', (args) => `sleep:${args[0]}ms`);
		wrap(page, 'waitForEvent', 'wait', (args) => `event:${args[0]}`);
		wrap(page, 'waitForFunction', 'wait', (args) =>
			String(args[0]).includes('#parse-status') ? 'parse-status predicate' : 'DOM predicate'
		);
		// Chained locators share this public-method prototype. Install once, in profile mode only.
		const prototype = Object.getPrototypeOf(page.locator('body'));
		if (!instrumented.has(prototype)) {
			instrumented.add(prototype);
			wrap(prototype, 'waitFor', 'wait', () => 'locator.waitFor');
			for (const method of [
				'click',
				'tap',
				'fill',
				'check',
				'uncheck',
				'selectOption',
				'hover',
				'focus'
			])
				wrap(prototype, method, 'action');
		}
	}
	function instrumentContext(context) {
		wrap(context, 'newPage', 'setup', undefined, instrumentPage);
		wrap(context, 'close', 'teardown', () => 'context.close');
	}
	function instrumentEngine(engine, name) {
		wrap(
			engine,
			'launch',
			'startup',
			() => `${name}.launch`,
			(browser) => {
				emit({
					type: 'browser',
					engine: name,
					version: browser.version(),
					executable: engine.executablePath()
				});
				wrap(browser, 'newContext', 'setup', undefined, instrumentContext);
				wrap(browser, 'close', 'teardown', () => 'browser.close');
			}
		);
	}
	function begin(name, category) {
		const parent = storage.getStore();
		const span = start(name, category);
		storage.enterWith(span);
		return () => {
			finish(span);
			storage.enterWith(parent);
		};
	}
	process.on('uncaughtExceptionMonitor', (error) => {
		emit({ type: 'failure', error: errorDetails(error) });
		for (const span of [...open.values()].reverse()) finish(span, 'failed', error);
	});
	process.on('exit', (code) => {
		for (const span of [...open.values()].reverse()) finish(span, 'incomplete');
		emit({ type: 'browser-exit', code });
	});
	return { measure: measured, begin, instrumentEngine };
}
