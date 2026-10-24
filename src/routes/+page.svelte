<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteDate } from 'svelte/reactivity';
	import { Temporal } from '@js-temporal/polyfill';
	import * as Core from '#lib/core/EventCore.gen.ts';
	import { fastTooltips } from '#lib/fastTooltips.ts';
	import { validZone } from '#lib/core/calendarAdapter.ts';

	const fields = [
		{ name: 'title', label: 'Title', hint: 'Optional event title' },
		{ name: 'start', label: 'Start', hint: 'Try tomorrow at 7pm, or a date for all-day' },
		{
			name: 'end',
			label: 'End/Duration',
			hint: 'Try tomorrow at 8pm. All-day End includes this date.'
		},
		{ name: 'location', label: 'Location', hint: 'Optional venue or address' }
	] as const;
	const captureContext = (): Core.context => ({
		referenceInstant: new Date().toISOString(),
		browserTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
	});
	let ready = $state(false);
	let displayNow = $state('2000-01-01T00:00:00Z');
	let draft = $state(
		Core.create({ referenceInstant: '2000-01-01T00:00:00Z', browserTimeZone: 'UTC' })
	);
	let result = $derived(Core.validate(draft));
	let zone = $derived(Core.effectiveZone(draft));
	let zoneDialog: HTMLDialogElement;
	let message = $state('');
	let readingClipboard = $state(false);
	let clipboardOperation = 0;
	let descriptionInput: HTMLTextAreaElement;
	let titleSelection = $state('');
	let selectionDescription = '';
	let selectionIdentity: Core.identity | undefined;

	function displayDateTime(value: string) {
		if (!/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/.test(value)) return value;
		try {
			const date = Temporal.PlainDate.from(value.slice(0, 10));
			const today = Temporal.Instant.from(displayNow)
				.toZonedDateTimeISO(validZone(zone) ? zone : draft.context.browserTimeZone)
				.toPlainDate();
			const days = today.until(date).days;
			const offset = days === 0 ? 'today' : `${days > 0 ? '+' : ''}${days}d`;
			return `${value} (${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][date.dayOfWeek - 1]}, ${offset})`;
		} catch {
			return value;
		}
	}

	function displayDateOption(value: string) {
		const formatted = displayDateTime(value);
		if (formatted === value) return value;
		const month = [
			'Jan',
			'Feb',
			'Mar',
			'Apr',
			'May',
			'Jun',
			'Jul',
			'Aug',
			'Sep',
			'Oct',
			'Nov',
			'Dec'
		][Number(value.slice(5, 7)) - 1];
		const year = value.slice(0, 4) === displayNow.slice(0, 4) ? '' : ` ${value.slice(0, 4)}`;
		return `${month} ${Number(value.slice(8, 10))}${year}${formatted.slice(10)}`;
	}

	function captureTitleSelection() {
		titleSelection = descriptionInput.value.slice(
			descriptionInput.selectionStart,
			descriptionInput.selectionEnd
		);
		selectionDescription = draft.description;
		selectionIdentity = draft.identity;
	}

	function useSelectionAsTitle() {
		if (
			!titleSelection.trim() ||
			selectionDescription !== draft.description ||
			selectionIdentity !== draft.identity
		)
			return;
		draft = Core.edit(draft, 'title', titleSelection);
		titleSelection = '';
		document.getElementById('title')?.focus();
	}
	let parseTimer: ReturnType<typeof setTimeout> | undefined;
	const newlyFocusedInputs = new WeakSet<HTMLInputElement>();
	function prepareInputSelection(input: HTMLInputElement) {
		if (document.activeElement !== input) newlyFocusedInputs.add(input);
		else newlyFocusedInputs.delete(input);
	}
	function finishInputSelection(input: HTMLInputElement) {
		// WebKit may collapse the focus selection during its native mouseup.
		if (!newlyFocusedInputs.delete(input)) return;
		const value = input.value;
		setTimeout(() => {
			if (document.activeElement === input && input.value === value) input.select();
		}, 0);
	}

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

	function openZoneDialog() {
		zoneDialog.showModal();
		// WebKit can reset the selection after native dialog autofocus.
		setTimeout(() => {
			const input = zoneDialog.querySelector('input');
			if (zoneDialog.open && document.activeElement === input) input?.select();
		}, 0);
	}

	function changeZone(value: string | undefined) {
		draft = Core.setZone(draft, value);
		scheduleParse(false, false);
	}

	onMount(() => {
		draft = Core.create(captureContext());
		ready = true;
		displayNow = draft.context.referenceInstant;
		const dayTimer = setInterval(() => {
			displayNow = new Date().toISOString();
		}, 60000);
		return () => {
			clearTimeout(parseTimer);
			clearInterval(dayTimer);
		};
	});

	function resetDraft() {
		// Ignore every completion from the discarded draft, including errors and cleanup.
		clipboardOperation += 1;
		readingClipboard = false;
		clearTimeout(parseTimer);
		titleSelection = '';
		draft = Core.create(captureContext());
		displayNow = draft.context.referenceInstant;
		zoneDialog?.close();
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
			titleSelection = '';
			draft = Core.replaceClipboard(draft, text, captureContext());
			displayNow = draft.context.referenceInstant;
			scheduleParse(true);
			zoneDialog?.close();
			message = '';
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

<main use:fastTooltips>
	<header>
		<h1>NL Event</h1>
	</header>
	<form onsubmit={(event) => event.preventDefault()}>
		<div class="description-heading">
			<label for="description">Description</label>
			<div class="description-actions">
				<button class="quiet-action" type="button" onclick={resetDraft} disabled={!ready}
					>Reset</button
				>
				<button
					class="quiet-action"
					type="button"
					onclick={pasteClipboard}
					disabled={!ready || readingClipboard}
				>
					{readingClipboard ? 'Reading clipboard...' : 'Paste from clipboard'}
				</button>
			</div>
		</div>
		<textarea
			id="description"
			bind:this={descriptionInput}
			value={draft.description}
			onselect={captureTitleSelection}
			oninput={(event) => {
				titleSelection = '';
				draft = Core.describe(draft, event.currentTarget.value);
				scheduleParse(event instanceof InputEvent && event.inputType === 'insertFromPaste');
			}}
			rows="7"
			aria-describedby="parse-status"
			disabled={!ready}></textarea>
		{#if titleSelection.trim()}
			<button class="inline outline" type="button" onclick={useSelectionAsTitle}>
				Use selection as Title
			</button>
		{/if}
		<p role="status" class:status-empty={!message}>{message}</p>
		<p
			id="parse-status"
			aria-live="polite"
			class:status-empty={draft.parseStatus !== 'pending' && draft.parseStatus !== 'failed'}
		>
			{#if draft.parseStatus === 'pending'}
				Parsing current Description...
			{:else if draft.parseStatus === 'failed'}
				{draft.parseError}
			{/if}
		</p>
		{#each fields as { name, label, hint } (name)}
			{@const field = Core.getField(draft, name)}
			{@const hasInput = !!draft.description.trim() || !!(field.input ?? field.value).trim()}
			{@const error = !hasInput
				? ''
				: name === 'start'
					? result.startError
					: name === 'end'
						? result.endError
						: ''}
			{@const warnings = Core.evidenceWarnings(draft, name)}
			{@const pairingWarning = !result.allDay && warnings.includes('Not paired in source')}
			{@const choices =
				name === 'start' ? result.startChoices : name === 'end' ? result.endChoices : []}
			<fieldset class="event-field" aria-label={label}>
				<legend class="field-heading">
					<span class="field-label">
						<label for={name}>{label}</label>
						{#if name === 'start'}
							<button
								type="button"
								class="zone-token"
								class:zone-hidden={result.allDay}
								aria-hidden={result.allDay}
								data-tooltip="Change time zone"
								aria-label="Change time zone"
								aria-haspopup="dialog"
								disabled={!ready || result.allDay}
								onclick={openZoneDialog}>{zone || 'Choose zone'}</button
							>
						{/if}
					</span>
				</legend>
				<span class="field-controls">
					<label class="ownership" data-tooltip="On: use suggestions. Off: keep this field Manual.">
						Auto
						<input
							type="checkbox"
							role="switch"
							aria-label={`Auto ${label}`}
							checked={field.ownership === 'auto'}
							disabled={!ready}
							onchange={(event) => {
								draft = Core.setAutomatic(draft, name, event.currentTarget.checked);
							}}
						/>
					</label>
				</span>
				<input
					id={name}
					type="text"
					onfocus={(event) => event.currentTarget.select()}
					onpointerdown={(event) => prepareInputSelection(event.currentTarget)}
					onclick={(event) => finishInputSelection(event.currentTarget)}
					placeholder={name === 'start'
						? 'e.g. 30min or tomorrow at 7pm'
						: name === 'end'
							? 'e.g. 4hr or tomorrow at 8pm'
							: undefined}
					value={field.input ?? field.value}
					disabled={!ready}
					oninput={(event) => {
						const now = new SvelteDate(Math.floor(Date.now() / 60000) * 60000);

						draft = Core.editAt(draft, name, event.currentTarget.value, now.toISOString());
					}}
					aria-invalid={error ? 'true' : undefined}
					aria-describedby={`${name}-hint${error ? ` ${name}-error` : ''}`}
				/>
				<small
					id={`${name}-hint`}
					class:error={!!error}
					aria-live={name === 'start' || name === 'end' ? 'polite' : undefined}
				>
					{#if error}<span id={`${name}-error`}>{error}</span>
					{:else if hasInput && (name === 'start' || name === 'end')}
						{@const interpreted = name === 'start' ? result.startValue : result.endValue}
						Interpreted as {displayDateTime(interpreted)}{interpreted.length === 10
							? name === 'end'
								? ' (all day, inclusive end)'
								: ' (all day)'
							: ''}.
						{#if !result.allDay && field.ownership === 'auto' && draft.suggestions.candidates.some((c) => c.field === name && c.value === field.value && c.inferred.includes('assumed-end'))}
							(inferred 60 min)
						{:else if !result.allDay && field.ownership === 'auto' && draft.suggestions.candidates.some((c) => c.field === name && c.value === field.value && c.inferred.includes('inferred-time'))}
							(inferred time){/if}
					{:else}{hint}{/if}
				</small>
				{#if name === 'end'}
					{@const duration = Core.durationValue(draft)}
					<div class="temporal-options">
						<small class="part-label"
							>Duration{duration > 0
								? ` · ${Core.durationLabel(duration, result.allDay)}`
								: ''}</small
						>
						<ul class="suggestions part-options" aria-label="End/Duration duration alternatives">
							{#each Core.durationOptions(draft) as option (option.amount)}
								<li>
									<button
										type="button"
										class="suggestion part-option"
										aria-pressed={option.selected}
										data-tooltip={option.source
											? `Suggested End - ${option.source}. Set End relative to Start.`
											: option.custom
												? 'Calculated from Start and End. Select to make End follow Start.'
												: 'Set End relative to Start.'}
										disabled={!ready || !!result.startError}
										onclick={() => {
											draft = Core.selectDuration(draft, option.amount);
										}}
									>
										<span class="selection-mark" aria-hidden="true"></span>{option.label}
									</button>
								</li>
							{/each}
						</ul>
					</div>
				{/if}
				{#if name === 'start' || name === 'end'}
					{#each ['date', 'time'] as part (part)}
						{@const options = Core.temporalOptions(draft, name, part as Core.temporalPart)}
						{#if options.length || part === 'time'}
							<div class="temporal-options">
								<small class="part-label"
									>{part === 'date' ? 'Date' : 'Time'}
									{#if part === 'time' && pairingWarning}<span
											class="pairing-warning"
											data-tooltip="This date and time were not paired in Description."
											>Not paired in source</span
										>{/if}
								</small>
								<ul class="suggestions part-options" aria-label={`${label} ${part} alternatives`}>
									{#if part === 'time'}
										<li>
											<button
												type="button"
												class="suggestion part-option"
												aria-pressed={result.allDay}
												disabled={!ready}
												data-tooltip={result.allDay
													? 'Select again to restore times'
													: 'Use calendar dates without times'}
												onclick={() => {
													draft = Core.setAllDay(draft, !result.allDay);
												}}
											>
												<span class="selection-mark" aria-hidden="true"></span>All day
											</button>
										</li>
									{/if}
									{#each options as option (option.value)}
										<li>
											<button
												type="button"
												class="suggestion part-option"
												class:unpaired={option.paired === false}
												aria-label={option.value}
												aria-pressed={option.selected && (part !== 'time' || !result.allDay)}
												data-tooltip={`${option.paired === undefined ? '' : option.paired ? 'Paired with this date - ' : 'Not paired with this date - '}${option.source}${option.note ? ` - ${option.note}` : ''}`}
												onclick={() => {
													draft = Core.selectTemporalPart(
														draft,
														name,
														part as Core.temporalPart,
														option.value
													);
												}}
											>
												<span class="selection-mark" aria-hidden="true"></span>
												<span
													>{part === 'date' ? displayDateOption(option.value) : option.value}</span
												>
												{#if option.note}<span class="note">({option.note})</span>{/if}
											</button>
										</li>
									{/each}
								</ul>
							</div>
						{/if}
					{/each}
				{:else if Core.alternatives(draft, name).length}
					<ul class="suggestions" aria-label={`${label} alternatives`}>
						{#each Core.alternatives(draft, name) as candidate (candidate.id)}
							<li>
								<button
									type="button"
									class="suggestion"
									aria-label={candidate.value}
									data-tooltip={candidate.value}
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
									<span class="selection-mark" aria-hidden="true"></span>
									<span class="interpreted">{candidate.value}</span>
								</button>
							</li>
						{/each}
					</ul>
				{/if}
				{#each warnings.filter((warning) => warning !== 'Not paired in source') as warning (warning)}<p
					>
						{warning}
					</p>{/each}
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
			</fieldset>
		{/each}
	</form>
	<dialog
		bind:this={zoneDialog}
		aria-labelledby="zone-dialog-title"
		onclose={() => {
			if (document.activeElement === document.body || zoneDialog.contains(document.activeElement)) {
				document.querySelector<HTMLButtonElement>('.zone-token')?.focus();
			}
		}}
	>
		<h2 id="zone-dialog-title">Choose time zone</h2>
		<p class="zone-provenance">
			{draft.zoneOverride !== undefined ? 'Manual override' : draft.suggestions.zoneProvenance}
		</p>
		<label for="zone">IANA time zone</label>
		<input
			id="zone"
			type="text"
			onfocus={(event) => event.currentTarget.select()}
			onpointerdown={(event) => prepareInputSelection(event.currentTarget)}
			onclick={(event) => finishInputSelection(event.currentTarget)}
			value={zone}
			placeholder="America/Chicago"
			aria-invalid={!validZone(zone)}
			aria-describedby="zone-hint"
			oninput={(event) => changeZone(event.currentTarget.value)}
		/>
		<p id="zone-hint">Changing zone preserves entered wall times and clears offset choices.</p>
		{#if !validZone(zone)}<p class="error">Enter a valid IANA time zone.</p>{/if}
		{#if draft.suggestions.zoneWarning && draft.zoneOverride === undefined}
			<p class="error">{draft.suggestions.zoneWarning}</p>
		{/if}
		<div class="actions">
			<button type="button" class="inline outline" onclick={() => changeZone(undefined)}
				>Use suggested zone</button
			>
			<button type="button" onclick={() => zoneDialog.close()}>Done</button>
		</div>
	</dialog>
	{#if draft.suggestions.warnings.includes('weekday-mismatch')}
		<p>The written weekday does not match the date. Check the suggested date.</p>
	{/if}
	{#if draft.suggestions.warnings.includes('multiple-source-dates')}
		<p>Description contains several dates. Review the alternatives above.</p>
	{/if}
	{#if draft.suggestions.warnings.includes('Inferred lesson end may overlap the social.')}
		<p>Inferred lesson end may overlap the social.</p>
	{/if}
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
	:global(html) {
		scrollbar-gutter: stable;
	}
	main {
		width: 100%;
		min-width: 0;
		box-sizing: border-box;
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
	.status-empty {
		display: none;
	}
	.event-field {
		position: relative;
		--heading-height: 1.75rem;
		min-width: 0;
		width: 100%;
		box-sizing: border-box;
		margin: 1rem 0;
		padding: 0.75rem;
		border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
		border-radius: 0.4rem;
	}
	.event-field > input {
		margin-block-end: 0.25rem;
	}
	legend.field-heading {
		width: auto;
		max-width: calc(100% - 5rem);
		min-height: var(--heading-height);
		box-sizing: border-box;
		padding-inline: 0.25rem;
	}
	.field-heading label {
		margin: 0;
	}
	.description-heading > label,
	.field-heading label {
		font-weight: 700;
	}
	.event-field > input {
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
	.description-heading {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.25rem 0.5rem;
	}
	.description-heading > label {
		margin: 0;
	}
	.description-actions {
		display: flex;
		justify-content: flex-end;
		flex-wrap: wrap;
		gap: 0.25rem 0.75rem;
		margin-inline-start: auto;
	}
	.quiet-action {
		margin: 0;
		padding: 0.25rem 0.4rem;
		min-height: 1.75rem;
		border: 1px solid transparent;
		background: transparent;
		color: inherit;
		opacity: 0.7;
		font-size: 0.8rem;
		font-weight: 400;
	}
	.quiet-action:hover:not(:disabled) {
		opacity: 1;
		background: color-mix(in srgb, currentColor 5%, transparent);
	}
	.quiet-action:focus-visible {
		outline: 2px solid currentColor;
		outline-offset: 2px;
	}
	@media (any-pointer: coarse) {
		.quiet-action {
			min-height: 2.75rem;
		}
	}
	.ownership {
		display: inline-flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.25rem;
	}
	.field-label {
		display: flex;
		align-items: center;
		flex-wrap: nowrap;
		gap: 0.5rem;
		flex: 1;
		min-width: 0;
	}
	.zone-token {
		min-height: var(--heading-height);
		height: var(--heading-height);
		box-sizing: border-box;
		min-width: 0;
		max-width: 100%;
		padding: 0.15rem 0;
		margin: 0;
		border: 0;
		background: transparent;
		color: inherit;
		opacity: 0.7;
		font-size: 0.8rem;
		font-weight: 400;
		text-decoration: underline;
		text-decoration-style: dotted;
		text-underline-offset: 0.2em;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.zone-hidden {
		display: none;
	}
	.field-label > label {
		flex-shrink: 0;
	}
	.event-field > small {
		display: block;
		margin: 0;
	}
	.zone-token:hover {
		opacity: 1;
	}
	.zone-token:focus-visible {
		outline: 2px solid currentColor;
		outline-offset: 3px;
	}
	dialog {
		width: min(30rem, calc(100% - 2rem));
		max-height: calc(100% - 2rem);
		box-sizing: border-box;
		overflow-y: auto;
		padding: 1.25rem;
		border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
		border-radius: 0.5rem;
		background: var(--nc-bg-1, white);
		color: var(--nc-tx-1, #222);
	}
	dialog::backdrop {
		background: rgb(0 0 0 / 35%);
	}
	dialog h2 {
		margin-top: 0;
	}
	.zone-provenance {
		opacity: 0.65;
		font-size: 0.875rem;
	}
	.field-controls {
		position: absolute;
		top: calc(var(--heading-height) / -2);
		inset-inline-end: 0.75rem;
		transform: translateY(-50%);
		padding-inline: 0.25rem;
		background: var(--nc-surface-1, #f8f9fa);
		display: flex;
		align-items: center;
		gap: 0.8rem;
	}
	.event-field .ownership {
		min-height: 1.75rem;
		font-size: 0.8rem;
		font-weight: 400;
		color: color-mix(in srgb, currentColor 65%, transparent);
		cursor: pointer;
	}
	.ownership input {
		margin: 0;
		color: inherit;
		--nc-primary: currentColor;
	}
	.ownership input:focus-visible {
		outline: 2px solid currentColor;
		outline-offset: 3px;
	}
	.inline {
		min-height: 1.75rem;
		border-color: transparent;
		text-decoration: underline;
		text-underline-offset: 0.15em;
	}
	@media (any-pointer: coarse) {
		.event-field {
			--heading-height: 2.75rem;
		}
		.inline,
		.zone-token,
		.event-field .ownership {
			min-height: 2.75rem;
		}
	}
	p {
		overflow-wrap: anywhere;
	}
	.suggestions {
		list-style: none;
		padding: 0;
		margin-block: 0.4rem;
		max-height: 18rem;
		overflow-y: auto;
	}
	.temporal-options {
		margin-top: 0.4rem;
	}
	.part-label {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		min-height: 1.2em;
	}
	.pairing-warning {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	:global(.fast-tooltip) {
		position: fixed;
		z-index: 10000;
		pointer-events: none;
		max-width: min(24rem, calc(100vw - 16px));
		box-sizing: border-box;
		padding: 0.35rem 0.55rem;
		border-radius: 0.3rem;
		background: #222;
		color: #fff;
		font-size: 0.8rem;
		line-height: 1.4;
		overflow-wrap: anywhere;
		box-shadow: 0 2px 8px #0003;
	}
	.temporal-options > small {
		opacity: 0.65;
		font-size: 0.75rem;
	}
	.part-options {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		max-height: 9rem;
		margin-block: 0.2rem;
	}
	.part-options > li {
		min-width: 0;
		max-width: 100%;
	}
	.suggestion.part-option {
		width: auto;
		max-width: 100%;
		margin: 0;
		gap: 0.25rem;
	}
	.suggestion {
		display: flex;
		justify-content: flex-start;
		align-items: baseline;
		gap: 0.5rem;
		width: 100%;
		min-height: 2rem;
		margin: 0.25rem 0;
		padding: 0.3rem 0.5rem;
		border: 1px solid color-mix(in srgb, currentColor 22%, transparent);
		border-radius: 0.2rem;
		background: transparent;
		box-shadow: none;
		color: inherit;
		font: inherit;
		font-size: 0.875rem;
		text-align: left;
		white-space: nowrap;
	}
	.suggestion.unpaired {
		border-style: dashed;
	}
	.suggestion.unpaired:not([aria-pressed='true']) {
		color: color-mix(in srgb, currentColor 70%, transparent);
	}
	.suggestion:hover {
		background: color-mix(in srgb, currentColor 4%, transparent);
	}
	.suggestion[aria-pressed='true'] {
		background: color-mix(in srgb, currentColor 7%, transparent);
	}
	.suggestion:focus-visible {
		outline: 2px solid var(--color-primary, #2563eb);
		outline-offset: -2px;
	}
	.selection-mark {
		width: 0.75rem;
		flex: 0 0 0.75rem;
	}
	.suggestion[aria-pressed='true'] .selection-mark::before {
		content: '\2713';
	}
	.interpreted {
		min-width: 0;
		font-weight: 600;
	}
	.interpreted {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.note {
		font-size: 0.8rem;
		opacity: 0.7;
	}
	@media (any-pointer: coarse) {
		.suggestion {
			min-height: 2.75rem;
		}
	}
	.error {
		color: var(--color-danger, #b42318);
	}
</style>
