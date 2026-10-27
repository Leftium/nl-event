import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { profile, measure } from './browser-profile.mjs';
import { parseRecords, summarize } from '../scripts/report-browser-profile.mjs';

test('normal runs return the original promise without timing hooks or a new async boundary', () => {
	assert.equal(profile, undefined);
	const pending = Promise.resolve('unchanged');
	assert.equal(
		measure('disabled', () => pending),
		pending
	);
	assert.throws(
		() =>
			measure('disabled', () => {
				throw new Error('original');
			}),
		/original/
	);
});

test('uncovered time subtracts the union of overlapping children, not their sum', () => {
	const result = summarize([
		{ type: 'span', id: 'parent', startMs: 0, endMs: 100 },
		{ type: 'span', id: 'a', parentId: 'parent', startMs: 10, endMs: 70 },
		{ type: 'span', id: 'b', parentId: 'parent', startMs: 40, endMs: 90 },
		{ type: 'span', id: 'grandchild', parentId: 'a', startMs: 20, endMs: 30 }
	]);
	assert.equal(result.spans[0].uncoveredMs, 20);
	assert.equal(result.spans[1].uncoveredMs, 50);
});

test('failure and unfinished spans survive a truncated final record', () => {
	const records = parseRecords(
		JSON.stringify({ type: 'start', id: 'unfinished', name: 'fixture' }) +
			'\n' +
			JSON.stringify({ type: 'span', id: 'done', startMs: 0, endMs: 4, status: 'failed' }) +
			'\n{"type":'
	);
	const result = summarize(records);
	assert.equal(result.unfinished[0].name, 'fixture');
	assert.equal(result.spans[0].status, 'failed');
	assert.equal(result.failures[0].type, 'incomplete-record');
	assert.throws(() => parseRecords('invalid\n{}\n'));
});

test('async spans retain fixture ancestry and uncaught errors finalize open scopes', () => {
	const directory = mkdtempSync(path.join(os.tmpdir(), 'nl-event-profiler-'));
	const file = path.join(directory, 'failure.jsonl');
	writeFileSync(file, '');
	try {
		const result = spawnSync(
			process.execPath,
			[
				'--input-type=module',
				'-e',
				`
			import { profile, measure } from ${JSON.stringify(new URL('./browser-profile.mjs', import.meta.url).href)};
			profile.begin('engine', 'engine');
			await measure('check', async () => {
				profile.begin('fixture', 'fixture');
				await measure('wait', () => Promise.resolve(), 'wait');
				throw new Error('deliberate failure');
			});
		`
			],
			{
				encoding: 'utf8',
				env: {
					...process.env,
					NL_EVENT_PROFILE_FILE: file,
					NL_EVENT_PROFILE_ORIGIN_NS: String(process.hrtime.bigint())
				}
			}
		);
		assert.notEqual(result.status, 0);
		const rows = parseRecords(readFileSync(file, 'utf8'));
		const spans = rows.filter((row) => row.type === 'span');
		const fixture = spans.find((row) => row.name === 'fixture');
		assert.equal(spans.find((row) => row.name === 'wait').parentId, fixture.id);
		assert.equal(fixture.parentId, spans.find((row) => row.name === 'check').id);
		assert.equal(fixture.status, 'failed');
		assert.equal(spans.find((row) => row.name === 'engine').status, 'failed');
		assert.equal(rows.find((row) => row.type === 'failure').error.message, 'deliberate failure');
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test('launcher appends after child writes and refuses to overwrite an existing report', () => {
	const directory = mkdtempSync(path.join(os.tmpdir(), 'nl-event-launcher-'));
	const file = path.join(directory, 'profile.jsonl');
	try {
		mkdirSync(path.join(directory, 'tests'));
		const compiler = path.join(directory, 'rescript');
		writeFileSync(compiler, `#!${process.execPath}\n`);
		chmodSync(compiler, 0o755);
		writeFileSync(
			path.join(directory, 'tests/browser-smoke.mjs'),
			`
			import { appendFileSync } from 'node:fs';
			appendFileSync(process.env.NL_EVENT_PROFILE_FILE, JSON.stringify({type:'browser-exit',code:0})+'\\n');
		`
		);
		const launcher = new URL('../scripts/profile-browser.mjs', import.meta.url);
		const options = {
			cwd: directory,
			encoding: 'utf8',
			env: { ...process.env, PATH: directory + path.delimiter + process.env.PATH }
		};
		const result = spawnSync(process.execPath, [launcher.pathname, file], options);
		assert.equal(result.status, 0, result.stderr);
		const original = readFileSync(file, 'utf8');
		const rows = original
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line));
		assert.ok(rows.some((row) => row.type === 'browser-exit'));
		assert.equal(rows.at(-1).id, 'command');
		assert.equal(rows.at(-1).status, 'passed');
		assert.equal(spawnSync(process.execPath, [launcher.pathname, file], options).status, 1);
		assert.equal(readFileSync(file, 'utf8'), original);
		writeFileSync(compiler, `#!${process.execPath}\nprocess.exit(7);\n`);
		const failed = path.join(directory, 'compile-failure.jsonl');
		assert.equal(spawnSync(process.execPath, [launcher.pathname, failed], options).status, 7);
		const failure = summarize(parseRecords(readFileSync(failed, 'utf8')));
		assert.equal(failure.spans.find((row) => row.id === 'compile').status, 'failed');
		assert.equal(
			failure.spans.some((row) => row.id === 'runner'),
			false
		);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
