<script lang="ts">
	import { onMount } from 'svelte';
	import * as Core from '#lib/core/EventCore.gen.ts';
	import { validZone } from '#lib/core/calendarAdapter.ts';

	const fields = [
		{ name: 'title', label: 'Title', hint: 'Optional event title' },
		{ name: 'start', label: 'Start', hint: 'YYYY-MM-DD HH:mm, or YYYY-MM-DD for all-day' },
		{ name: 'end', label: 'End', hint: 'Same format as Start. All-day End includes this date.' },
		{ name: 'location', label: 'Location', hint: 'Optional venue or address' }
	] as const;
	const captureContext = (): Core.context => ({
		referenceInstant: new Date().toISOString(),
		browserTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
	});
	let ready = $state(false);
	let draft = $state(
		Core.create({ referenceInstant: '2000-01-01T00:00:00Z', browserTimeZone: 'UTC' })
	);
	let result = $derived(Core.validate(draft));
	let zone = $derived(Core.effectiveZone(draft));
	let zoneEditor = $state(false);
	let message = $state('');
	let readingClipboard = $state(false);
	let clipboardOperation = 0;
	let descriptionInput: HTMLTextAreaElement;
	let parseTimer: ReturnType<typeof setTimeout> | undefined;

	function scheduleParse(immediate = false, applyValues = true) {
		clearTimeout(parseTimer);
		if (draft.parseStatus !== 'pending') return;
		const snapshot = draft;
		const ticket = Core.parseTicket(snapshot);
		const run = async () => {
			try {
				const output = await Promise.resolve().then(() => Core.extract(snapshot));
				draft = Core.completeParse(draft, ticket, output, applyValues);
			} catch {
				draft = Core.failParse(
					draft,
					ticket,
					'Could not parse this Description. You can enter fields manually.'
				);
			}
		};
		if (immediate) void run();
		else parseTimer = setTimeout(run, 250);
	}

	function changeZone(value: string | undefined) {
		draft = Core.setZone(draft, value);
		scheduleParse(false, false);
	}

	onMount(() => {
		draft = Core.create(captureContext());
		ready = true;
		return () => clearTimeout(parseTimer);
	});

	function newEvent() {
		if (Core.populated(draft) && !window.confirm('Discard this draft and start a new event?'))
			return;
		// Ignore every completion from the discarded draft, including errors and cleanup.
		clipboardOperation += 1;
		readingClipboard = false;
		clearTimeout(parseTimer);
		draft = Core.create(captureContext());
		zoneEditor = false;
		message = '';
		descriptionInput.focus();
	}

	async function pasteClipboard() {
		const operation = ++clipboardOperation;
		readingClipboard = true;
		try {
			const text = await navigator.clipboard.readText();
			if (operation !== clipboardOperation) return;
			if (!text) {
				message = 'Clipboard is empty. Your draft is unchanged.';
				return;
			}
			if (Core.populated(draft) && !window.confirm('Replace this draft with the clipboard text?'))
				return;
			draft = Core.replaceClipboard(draft, text, true, captureContext());
			scheduleParse(true);
			zoneEditor = false;
			message = 'Clipboard text added. Review the suggested fields below.';
			descriptionInput.focus();
		} catch {
			if (operation === clipboardOperation) {
				message = 'Clipboard could not be read. Paste directly into Description instead.';
			}
		} finally {
			if (operation === clipboardOperation) readingClipboard = false;
		}
	}

	function download() {
		const event = Core.validate(draft).event;
		if (!event) return;
		draft = Core.withUid(draft, `${crypto.randomUUID()}@nl-event`);
		const stamp = new Date()
			.toISOString()
			.replace(/[-:]/g, '')
			.replace(/\.\d{3}Z$/, 'Z');
		const blob = new Blob([Core.ics(event, draft.uid!, stamp)], {
			type: 'text/calendar;charset=utf-8'
		});
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = 'event.ics';
		link.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
		message = 'Calendar file prepared. Import it into your calendar to save the event.';
	}
</script>

<svelte:head>
	<title>NL Event - Prepare a calendar event</title>
	<meta
		name="description"
		content="Prepare one event draft and open it in Google Calendar or download an iCalendar file."
	/>
</svelte:head>

<main>
	<header>
		<h1>NL Event</h1>
	</header>
	<div class="actions">
		<button class="outline" type="button" onclick={newEvent} disabled={!ready}>New event</button>
		<button
			class="outline"
			type="button"
			onclick={pasteClipboard}
			disabled={!ready || readingClipboard}
		>
			{readingClipboard ? 'Reading clipboard...' : 'Paste from clipboard'}
		</button>
	</div>
	<p role="status">{message}</p>
	<form onsubmit={(event) => event.preventDefault()}>
		<label for="description">Description</label>
		<textarea
			id="description"
			bind:this={descriptionInput}
			value={draft.description}
			oninput={(event) => {
				draft = Core.describe(draft, event.currentTarget.value);
				scheduleParse(event instanceof InputEvent && event.inputType === 'insertFromPaste');
			}}
			rows="7"
			aria-describedby="parse-status"
			disabled={!ready}></textarea>
		<p id="parse-status">
			{#if draft.parseStatus === 'pending'}
				Parsing current Description...
			{:else if draft.parseStatus === 'failed'}
				{draft.parseError}
			{:else if draft.suggestions.candidates.length}
				Review alternatives under each field. Selecting one changes only that field.
			{:else}
				No supported suggestions. Enter the fields manually, or add event details to Description.
			{/if}
			Description is exported as entered.
		</p>
		{#each fields as { name, label, hint } (name)}
			{@const field = Core.getField(draft, name)}
			{@const error = name === 'start' ? result.startError : name === 'end' ? result.endError : ''}
			{@const choices =
				name === 'start' ? result.startChoices : name === 'end' ? result.endChoices : []}
			<div class="field-heading">
				<label for={name}>{label}</label>
				<span class="ownership">
					<span>{field.ownership === 'auto' ? 'Auto' : 'Manual'}</span>
					{#if field.ownership === 'manual'}
						<button
							class="inline outline"
							type="button"
							aria-label={`Reset ${label} to suggested`}
							onclick={() => {
								draft = Core.reset(draft, name);
							}}>Reset to suggested</button
						>
					{/if}
				</span>
			</div>
			<input
				id={name}
				type="text"
				value={field.value}
				disabled={!ready}
				oninput={(event) => {
					draft = Core.edit(draft, name, event.currentTarget.value);
				}}
				aria-invalid={error ? 'true' : undefined}
				aria-describedby={`${name}-hint${error ? ` ${name}-error` : ''}`}
			/>
			<p id={`${name}-hint`}>{hint}</p>
			{#if error}<p class="error" id={`${name}-error`}>{error}</p>{/if}
			{#if Core.alternatives(draft, name).length}
				<ul class="suggestions" aria-label={`${label} alternatives`}>
					{#each Core.alternatives(draft, name) as candidate (candidate.id)}
						<li>
							<button
								type="button"
								class="outline"
								aria-pressed={field.value === candidate.value ||
									draft.selections.some(
										(s) =>
											s.name === name &&
											s.revision === draft.revision &&
											s.candidate.id === candidate.id
									)}
								onclick={() => {
									draft = Core.selectCandidate(draft, name, candidate.id);
								}}
							>
								{candidate.value}
							</button>
							<small
								>{candidate.completeness === 'time-only'
									? 'Date missing or AM/PM unresolved'
									: candidate.completeness === 'date-only'
										? 'Time missing'
										: candidate.label}
								{#if candidate.inferred.length}
									({candidate.inferred.join(', ')}){/if}
							</small>
							<details>
								<summary>Source and activity</summary>
								<p>{candidate.groups.join(', ')}</p>
								{#each candidate.spans as span, i (i)}<blockquote>
										{draft.description.slice(span.start, span.end)}
									</blockquote>{/each}
							</details>
						</li>
					{/each}
				</ul>
			{/if}
			{#each Core.evidenceWarnings(draft, name) as warning (warning)}<p>{warning}</p>{/each}
			{#if choices.length > 1}
				<fieldset>
					<legend>{label} occurs twice in {zone}. Choose an offset.</legend>
					{#each choices as choice, i (choice.offset)}
						<label
							><input
								type="radio"
								name={`${name}-offset`}
								value={choice.offset}
								checked={field.offset === choice.offset}
								onchange={() => {
									draft = Core.chooseOffset(draft, name, choice.offset);
								}}
							/>
							{i === 0 ? 'Earlier' : 'Later'} (UTC{choice.offset})</label
						>
					{/each}
				</fieldset>
			{/if}
			{#if name === 'start'}
				<p class="zone-context">
					<span
						>Time zone: {zone || '(empty)'} ({draft.zoneOverride !== undefined
							? 'Manual override'
							: draft.suggestions.zoneProvenance}).</span
					>
					<button
						class="inline outline"
						type="button"
						onclick={() => {
							zoneEditor = !zoneEditor;
						}}
						aria-expanded={zoneEditor}>Change time zone</button
					>
				</p>
				{#if zoneEditor}
					<label for="zone">IANA time zone</label>
					<input
						id="zone"
						value={zone}
						placeholder="America/Chicago"
						aria-invalid={!validZone(zone)}
						aria-describedby="zone-hint"
						oninput={(event) => {
							changeZone(event.currentTarget.value);
						}}
					/>
					<p id="zone-hint">
						Changing zone preserves entered wall times and clears offset choices. All-day dates do
						not use a time zone.
					</p>
					<button
						type="button"
						class="inline outline"
						onclick={() => {
							changeZone(undefined);
						}}>Use suggested zone</button
					>
				{/if}
			{/if}
		{/each}
	</form>
	{#if draft.suggestions.zoneWarning && draft.zoneOverride === undefined}<p class="error">
			{draft.suggestions.zoneWarning}
		</p>{/if}
	{#each draft.suggestions.warnings as warning (warning)}<p>{warning}</p>{/each}
	{#each result.warnings as warning (warning)}<p>{warning}</p>{/each}
	<div class="actions">
		{#if ready && result.event}
			<!-- External calendar URL; this is not a SvelteKit route. -->
			<!-- eslint-disable svelte/no-navigation-without-resolve -->
			<a
				class="nc-button"
				href={Core.googleUrl(result.event)}
				target="_blank"
				rel="noopener noreferrer">Open in Google Calendar</a
			>
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
		{:else}
			<button type="button" disabled>Open in Google Calendar</button>
		{/if}
		<button class="secondary" type="button" onclick={download} disabled={!ready || !result.event}
			>Download .ics</button
		>
	</div>
	<p>Google Calendar opens an editable form. Finish saving there. Exporting keeps this draft.</p>
	<p>
		Long descriptions can exceed browser URL limits and appear in browser history. Download .ics to
		keep the full text in a file.
	</p>
</main>

<style>
	main {
		max-width: 46rem;
		margin: 0 auto;
		padding: 1rem;
	}
	.actions,
	.field-heading {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.75rem;
	}
	.field-heading {
		margin-top: 1.5rem;
	}
	.field-heading label {
		margin: 0;
	}
	form > label,
	.field-heading label {
		font-weight: 700;
	}
	.field-heading + input {
		margin-block-start: 0.25rem;
	}
	input[type='text'],
	textarea {
		width: 100%;
		box-sizing: border-box;
	}
	.actions button,
	.actions a {
		min-height: 2.75rem;
	}
	.ownership,
	.zone-context {
		display: inline-flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.25rem;
	}
	.inline {
		min-height: 1.75rem;
		border-color: transparent;
		text-decoration: underline;
		text-underline-offset: 0.15em;
	}
	@media (any-pointer: coarse) {
		.inline {
			min-height: 2.75rem;
		}
	}
	p {
		overflow-wrap: anywhere;
	}
	.suggestions {
		padding-left: 1.25rem;
		max-height: 18rem;
		overflow-y: auto;
	}
	.suggestions li {
		margin-block: 0.5rem;
	}
	.suggestions small {
		margin-inline: 0.5rem;
	}
	.suggestions button {
		min-height: 2.75rem;
		max-width: 100%;
		overflow-wrap: anywhere;
	}
	.suggestions [aria-pressed='true'] {
		font-weight: 700;
		border-width: 2px;
	}
	.suggestions blockquote {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.error {
		color: var(--color-danger, #b42318);
	}
</style>
