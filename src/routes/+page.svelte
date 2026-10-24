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
	let descriptionInput: HTMLTextAreaElement;

	onMount(() => {
		draft = Core.create(captureContext());
		ready = true;
	});

	function newEvent() {
		if (Core.populated(draft) && !window.confirm('Discard this draft and start a new event?'))
			return;
		draft = Core.create(captureContext());
		zoneEditor = false;
		message = '';
		descriptionInput.focus();
	}

	async function pasteClipboard() {
		readingClipboard = true;
		try {
			const text = await navigator.clipboard.readText();
			if (!text) {
				message = 'Clipboard is empty. Your draft is unchanged.';
				return;
			}
			if (Core.populated(draft) && !window.confirm('Replace this draft with the clipboard text?'))
				return;
			draft = Core.replaceClipboard(draft, text, true, captureContext());
			zoneEditor = false;
			message = 'Clipboard text added. Enter the event fields below.';
			descriptionInput.focus();
		} catch {
			message = 'Clipboard could not be read. Paste directly into Description instead.';
		} finally {
			readingClipboard = false;
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
		<p>Prepare an event, then finish in your calendar.</p>
	</header>
	<div class="actions">
		<button type="button" onclick={newEvent} disabled={!ready}>New event</button>
		<button type="button" onclick={pasteClipboard} disabled={!ready || readingClipboard}>
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
			}}
			rows="7"
			aria-describedby="parse-status"
			disabled={!ready}></textarea>
		<p id="parse-status">
			Manual entry is available. Language parsing and suggestions are not available yet. Description
			is exported as entered.
		</p>
		{#each fields as { name, label, hint } (name)}
			{@const field = Core.getField(draft, name)}
			{@const error = name === 'start' ? result.startError : name === 'end' ? result.endError : ''}
			{@const choices =
				name === 'start' ? result.startChoices : name === 'end' ? result.endChoices : []}
			<div class="field-heading">
				<label for={name}>{label}</label>
				<span>{field.ownership === 'auto' ? 'Auto' : 'Manual'}</span>
				{#if field.ownership === 'manual'}
					<button
						type="button"
						aria-label={`Reset ${label} to suggested`}
						onclick={() => {
							draft = Core.reset(draft, name);
						}}>Reset to suggested</button
					>
				{/if}
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
				<p>
					Time zone: {zone || '(empty)'} ({draft.zoneOverride !== undefined
						? 'Manual override'
						: 'Browser fallback'}).
					<button
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
							draft = Core.setZone(draft, event.currentTarget.value);
						}}
					/>
					<p id="zone-hint">
						Changing zone preserves entered wall times and clears offset choices. All-day dates do
						not use a time zone.
					</p>
					<button
						type="button"
						onclick={() => {
							draft = Core.setZone(draft, undefined);
						}}>Use suggested zone</button
					>
				{/if}
			{/if}
		{/each}
	</form>
	{#each result.warnings as warning (warning)}<p>{warning}</p>{/each}
	<div class="actions">
		{#if ready && result.event}
			<!-- External calendar URL; this is not a SvelteKit route. -->
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
			<a href={Core.googleUrl(result.event)} target="_blank" rel="noopener noreferrer"
				>Open in Google Calendar</a
			>
		{:else}
			<button type="button" disabled>Open in Google Calendar</button>
		{/if}
		<button type="button" onclick={download} disabled={!ready || !result.event}
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
	input[type='text'],
	textarea {
		width: 100%;
		box-sizing: border-box;
	}
	button,
	.actions a {
		min-height: 2.75rem;
	}
	p {
		overflow-wrap: anywhere;
	}
	.error {
		color: var(--color-danger, #b42318);
	}
</style>
