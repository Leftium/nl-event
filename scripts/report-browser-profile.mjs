import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';

export function parseRecords(text) {
	const lines = text.trimEnd().split('\n');
	return lines.flatMap((line, index) => {
		if (!line.trim()) return [];
		try {
			return [JSON.parse(line)];
		} catch (error) {
			if (index !== lines.length - 1) throw error;
			return [{ type: 'incomplete-record', line: index + 1, error: error.message }];
		}
	});
}

export function summarize(records) {
	const starts = new Map(records.filter((row) => row.type === 'start').map((row) => [row.id, row]));
	const spans = records.filter((row) => row.type === 'span');
	for (const span of spans) starts.delete(span.id);
	const unionLength = (intervals) => {
		let end = -Infinity;
		let total = 0;
		for (const [a, b] of intervals.sort((x, y) => x[0] - y[0])) {
			total += Math.max(0, b - Math.max(a, end));
			end = Math.max(end, b);
		}
		return total;
	};
	return {
		environment: records.find((row) => row.type === 'environment'),
		browsers: records.filter((row) => row.type === 'browser'),
		failures: records.filter((row) =>
			['failure', 'incomplete-command', 'incomplete-record'].includes(row.type)
		),
		unfinished: [...starts.values()],
		spans: spans.map((span) => {
			const durationMs = span.endMs - span.startMs;
			const children = spans.filter((child) => child.parentId === span.id);
			const covered = unionLength(
				children
					.map((child) => [
						Math.max(span.startMs, child.startMs),
						Math.min(span.endMs, child.endMs)
					])
					.filter(([a, b]) => b > a)
			);
			return { ...span, durationMs, uncoveredMs: durationMs - covered };
		})
	};
}

// The reporter is also imported by focused accounting tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const input = readFileSync(process.argv[2]);
	const records = parseRecords(
		(process.argv[2].endsWith('.gz') ? gunzipSync(input) : input).toString('utf8')
	);
	console.log(JSON.stringify(summarize(records), null, 2));
}
