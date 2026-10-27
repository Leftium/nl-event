import fs from 'node:fs';
import { gunzipSync } from 'node:zlib';

const path = process.argv[2];
if (!path) throw new Error('Usage: node scripts/report-editor-profile.mjs <profile.json[.gz]>');
const bytes = fs.readFileSync(path);
const data = JSON.parse((path.endsWith('.gz') ? gunzipSync(bytes) : bytes).toString());
if (data.status !== 'passed') throw new Error('Cannot summarize an incomplete profile');
const median = (values) => {
	const sorted = values.toSorted((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const sum = (values) => values.reduce((a, b) => a + b, 0);
const groups = Map.groupBy(data.samples, (sample) =>
	[sample.engine, sample.mode, sample.size, sample.stage].join('/')
);
const summary = {
	environment: data.environment,
	conditions: data.conditions,
	sourceHashes: data.sourceHashes,
	calibration: data.calibration,
	groups: {}
};
for (const [key, samples] of groups) {
	const names = [...new Set(samples.flatMap((sample) => sample.rows.map((row) => row.name)))];
	summary.groups[key] = {
		samples: samples.length,
		wallMedianMs: median(samples.map((sample) => sample.wallMs)),
		wallRangeMs: [
			Math.min(...samples.map((sample) => sample.wallMs)),
			Math.max(...samples.map((sample) => sample.wallMs))
		],
		rootMedianMs: median(
			samples.map((sample) =>
				sum(sample.rows.filter((row) => row.parent === null).map((row) => row.ms))
			)
		),
		inputCount: samples.map((sample) => sample.inputEvents.length),
		inputTypes: [
			...new Set(samples.flatMap((sample) => sample.inputEvents.map((event) => event.inputType)))
		],
		renderingMedian: Object.fromEntries(
			Object.keys(samples[0].rendering).map((name) => [
				name,
				median(samples.map((sample) => sample.rendering[name]))
			])
		),
		spans: Object.fromEntries(
			names.map((name) => [
				name,
				{
					counts: samples.map((sample) => sample.rows.filter((row) => row.name === name).length),
					inclusiveMedianMs: median(
						samples.map((sample) =>
							sum(sample.rows.filter((row) => row.name === name).map((row) => row.ms))
						)
					),
					selfMedianMs: median(
						samples.map((sample) =>
							sum(sample.rows.filter((row) => row.name === name).map((row) => row.selfMs))
						)
					)
				}
			])
		)
	};
}
console.log(JSON.stringify(summary, null, 2));
