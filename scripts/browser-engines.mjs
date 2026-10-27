// Shared by the Node-only runner and profiler; reject typos before launching work.
export function selectBrowserEngines(selection = process.env.NL_EVENT_BROWSER_ENGINE) {
	if (selection === undefined || selection === 'both') return ['chromium', 'webkit'];
	if (selection === 'chromium' || selection === 'webkit') return [selection];
	throw new Error(
		`Invalid NL_EVENT_BROWSER_ENGINE: ${JSON.stringify(selection)}. Expected chromium, webkit, or both (or leave unset).`
	);
}
