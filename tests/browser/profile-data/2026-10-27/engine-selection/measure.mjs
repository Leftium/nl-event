import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
const root = '/tmp/nl-event-pr50';
const environment = {
	node: process.version,
	platform: os.platform(),
	release: os.release(),
	arch: os.arch(),
	cpu: os.cpus()[0].model,
	playwright: JSON.parse(fs.readFileSync('node_modules/playwright/package.json')).version,
	server:
		'Agent-started Vite dev server http://localhost:5173/; same process for all samples; one complete full-suite warmup before measurements'
};
fs.writeFileSync(`${root}/environment.json`, JSON.stringify(environment, null, 2) + '\n');
for (const [label, command, engines] of [
	['warmup', 'test:browser', ['chromium', 'webkit']],
	['chromium', 'test:browser:chromium', ['chromium']],
	['webkit', 'test:browser:webkit', ['webkit']],
	['both', 'test:browser', ['chromium', 'webkit']]
]) {
	const origin = process.hrtime.bigint();
	const file = `${root}/${label}.jsonl`;
	fs.writeFileSync(
		file,
		JSON.stringify({ type: 'environment', selectedEngines: engines, ...environment }) + '\n',
		{ flag: 'wx' }
	);
	const log = fs.openSync(`${root}/${label}.log`, 'wx');
	const env = {
		...process.env,
		NL_EVENT_PROFILE_FILE: file,
		NL_EVENT_PROFILE_ORIGIN_NS: String(origin)
	};
	delete env.NL_EVENT_BROWSER_ENGINE;
	const result = spawnSync('pnpm', [command], { env, stdio: ['ignore', log, log] });
	const metrics = {
		label,
		command: `pnpm ${command}`,
		wallSeconds: Number(process.hrtime.bigint() - origin) / 1e9,
		exitCode: result.status
	};
	fs.writeFileSync(`${root}/${label}-command.json`, JSON.stringify(metrics, null, 2) + '\n');
	console.log(JSON.stringify(metrics));
	console.log(fs.readFileSync(`${root}/${label}.log`, 'utf8').split('\n').slice(-5).join('\n'));
	if (result.status !== 0) process.exit(result.status ?? 1);
}
