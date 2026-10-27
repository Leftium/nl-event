import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, openSync, writeSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const origin = process.hrtime.bigint();
const require = createRequire(import.meta.url);
const output = path.resolve(process.argv[2] ?? `browser-profile-${Date.now()}.jsonl`);
mkdirSync(path.dirname(output), { recursive: true });
// Never overwrite an earlier run, including a failed one.
const fd = openSync(output, 'ax');
const emit = (record) => writeSync(fd, JSON.stringify(record) + '\n');
const now = () => Number(process.hrtime.bigint() - origin) / 1e6;
const inspect = (command, args) => {
	try {
		return execFileSync(command, args, { encoding: 'utf8' }).trim();
	} catch (error) {
		return { unavailable: error.message };
	}
};
emit({
	type: 'environment',
	schemaVersion: 1,
	startedAt: new Date().toISOString(),
	command: process.argv,
	cwd: process.cwd(),
	commit: inspect('git', ['rev-parse', 'HEAD']),
	workingTree: inspect('git', ['status', '--short']),
	node: process.version,
	pnpm: process.env.npm_config_user_agent,
	playwright: require('playwright/package.json').version,
	platform: {
		os: os.platform(),
		release: os.release(),
		arch: os.arch(),
		cpu: os.cpus()[0]?.model,
		logicalCpus: os.cpus().length,
		memoryBytes: os.totalmem()
	},
	baseUrl: process.env.NL_EVENT_BASE_URL ?? 'http://localhost:5173/',
	serverCondition:
		process.env.NL_EVENT_PROFILE_SERVER ??
		'Unspecified existing server; annotate before comparison',
	overlap:
		'All spans are inclusive. Children overlap parents; concurrent siblings may overlap. Union child intervals before calculating uncovered time.'
});
let active;
let completed = false;
emit({
	type: 'start',
	id: 'command',
	parentId: null,
	category: 'command',
	name: 'profile command',
	startMs: 0
});
process.on('exit', (code) => {
	if (!completed) emit({ type: 'incomplete-command', code, active, endMs: now() });
});
async function stage(id, command, args, env = process.env) {
	active = id;
	const startMs = now();
	emit({
		type: 'start',
		id,
		parentId: 'command',
		category: id === 'compile' ? 'compile' : 'runner',
		name: id,
		startMs
	});
	const result = await new Promise((resolve) => {
		const child = spawn(command, args, { stdio: 'inherit', env });
		const interrupt = () => child.kill('SIGINT');
		const terminate = () => child.kill('SIGTERM');
		process.once('SIGINT', interrupt);
		process.once('SIGTERM', terminate);
		child.once('close', () => {
			process.removeListener('SIGINT', interrupt);
			process.removeListener('SIGTERM', terminate);
		});
		child.on('error', (error) =>
			resolve({ code: 1, error: { message: error.message, stack: error.stack } })
		);
		child.on('exit', (code, signal) => resolve({ code: code ?? 1, signal }));
	});
	const endMs = now();
	emit({
		type: 'span',
		id,
		parentId: 'command',
		category: id === 'compile' ? 'compile' : 'runner',
		name: id,
		startMs,
		endMs,
		durationMs: endMs - startMs,
		status: result.code === 0 ? 'passed' : 'failed',
		...result
	});
	return result.code;
}
let code = await stage('compile', 'rescript', []);
if (!code)
	code = await stage('runner', process.execPath, ['tests/browser-smoke.mjs'], {
		...process.env,
		NL_EVENT_PROFILE_FILE: output,
		NL_EVENT_PROFILE_ORIGIN_NS: String(origin)
	});
emit({
	type: 'span',
	id: 'command',
	parentId: null,
	category: 'command',
	name: 'profile command',
	startMs: 0,
	endMs: now(),
	status: code === 0 ? 'passed' : 'failed',
	code
});
completed = true;
process.exitCode = code;
console.log(`Browser profile: ${output}`);
