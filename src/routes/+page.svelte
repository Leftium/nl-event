<script lang="ts">
	import { onMount, tick } from 'svelte';
	import AnnouncementLinks from '#lib/AnnouncementLinks.svelte';
	import { setSignupLink, signupSource, veneerLink } from '#lib/calendarDescription.ts';
	import { discoverLinks, groupEquivalentLinks } from '#lib/announcementLinks.ts';
	import type { EvidenceRange } from '#lib/evidenceHighlight.ts';
	import { descriptionEditor } from '#lib/descriptionEditor.ts';
	import { SvelteDate } from 'svelte/reactivity';
	import { Temporal } from '@js-temporal/polyfill';
	import * as Core from '#lib/core/EventCore.gen.ts';
	import { fastTooltips } from '#lib/fastTooltips.ts';
	import { overnightExport } from '#lib/core/overnightExport.ts';
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
	let links = $derived(groupEquivalentLinks(discoverLinks(draft.description)));
	let trimOvernight = $state(true);
	let overnight = $derived(overnightExport(result.event, trimOvernight));
	let exportEvent = $derived(overnight.event);
	let googleUrl = $derived(exportEvent ? Core.googleUrl(exportEvent) : '');
	let longGoogleUrl = $derived(googleUrl.length > 8000);
	let zone = $derived(Core.effectiveZone(draft));
	let zoneDialog: HTMLDialogElement;
	let message = $state('');
	let readingClipboard = $state(false);
	let clipboardOperation = 0;
	let descriptionInput: HTMLTextAreaElement;
	let descriptionFullscreen = $state(false);
	let descriptionWrap = $state(true);
	let expandedDates = $state({ start: false, end: false });

	function collapseDates() {
		expandedDates = { start: false, end: false };
	}
	type Evidence = {
		node: HTMLElement;
		ranges: readonly EvidenceRange[];
		identity: Core.identity;
		revision: number;
		contextRevision: number;
		description: string;
		suggestions: Core.draft['suggestions'];
	};
	let hoveredEvidence = $state<Evidence>();
	let focusedEvidence = $state<Evidence>();
	let evidence = $derived(hoveredEvidence ?? focusedEvidence);
	let linkHighlight = $state<{ description: string; range: EvidenceRange }>();
	let linkRange = $derived(
		linkHighlight?.description === draft.description ? linkHighlight.range : undefined
	);
	let evidenceRanges = $derived(
		evidence &&
			draft.parseStatus === 'ready' &&
			evidence.identity === draft.identity &&
			evidence.revision === draft.revision &&
			evidence.contextRevision === draft.contextRevision &&
			evidence.description === draft.description &&
			evidence.suggestions === draft.suggestions
			? evidence.ranges
			: []
	);

	const candidateSelected = (
		name: Core.fieldName,
		candidate: ReturnType<typeof Core.alternatives>[number]
	) =>
		Core.getField(draft, name).value === candidate.value ||
		draft.selections.some(
			(s) => s.name === name && s.revision === draft.revision && s.candidate.id === candidate.id
		);
	let sourceHighlights = $derived.by(() => {
		const selected: EvidenceRange[] = [];
		const unselected: EvidenceRange[] = [];
		if (draft.parseStatus !== 'ready') return { selected, unselected };
		for (const { name } of fields) {
			if (name === 'start' || name === 'end') {
				for (const part of ['date', 'time'] as const) {
					for (const option of Core.temporalOptions(draft, name, part)) {
						const chosen = option.selected && (part !== 'time' || !result.allDay);
						(chosen ? selected : unselected).push(...(option.evidence ?? []));
					}
				}
			} else {
				for (const candidate of Core.alternatives(draft, name)) {
					(candidateSelected(name, candidate) ? selected : unselected).push(
						...(candidate.textSpans ?? [])
					);
				}
			}
		}
		return { selected, unselected };
	});

	let textEvidence = $state<{ range: EvidenceRange; suggestions: Core.draft['suggestions'] }>();
	let textRange = $derived(
		draft.parseStatus === 'ready' && textEvidence?.suggestions === draft.suggestions
			? textEvidence.range
			: undefined
	);
	const overlapsText = (range: EvidenceRange) =>
		!!textRange && range.start < textRange.end && range.end > textRange.start;
	const matchesTextEvidence = (ranges: readonly EvidenceRange[] = []) => ranges.some(overlapsText);
	let textPreviewRanges = $derived(
		textRange
			? [...sourceHighlights.selected, ...sourceHighlights.unselected].filter(overlapsText)
			: []
	);

	function previewText(range?: EvidenceRange) {
		if (!range) {
			textEvidence = undefined;
			return;
		}
		if (textRange?.start === range.start && textRange.end === range.end) return;
		hoveredEvidence = undefined;
		textEvidence = { range, suggestions: draft.suggestions };
	}

	function clearEvidence() {
		linkHighlight = undefined;
		textEvidence = undefined;
		hoveredEvidence = focusedEvidence = undefined;
	}

	function chipEvidence(node: HTMLElement, ranges: readonly EvidenceRange[]) {
		let current = ranges;
		const snapshot = (): Evidence => ({
			node,
			ranges: current,
			identity: draft.identity,
			revision: draft.revision,
			contextRevision: draft.contextRevision,
			description: draft.description,
			suggestions: draft.suggestions
		});
		const enter = () => {
			textEvidence = undefined;
			hoveredEvidence = snapshot();
		};
		const leave = () => {
			if (hoveredEvidence?.node === node) hoveredEvidence = undefined;
		};
		const focus = () => {
			if (node.matches(':focus-visible')) {
				textEvidence = undefined;
				focusedEvidence = snapshot();
			}
		};
		const blur = () => {
			if (focusedEvidence?.node === node) focusedEvidence = undefined;
		};
		const pointerdown = () => {
			focusedEvidence = undefined;
		};
		node.addEventListener('pointerenter', enter);
		node.addEventListener('pointerleave', leave);
		node.addEventListener('focus', focus);
		node.addEventListener('blur', blur);
		node.addEventListener('pointerdown', pointerdown);
		return {
			update(next: readonly EvidenceRange[]) {
				const changed =
					current.length !== next.length ||
					current.some(
						(range, index) => range.start !== next[index].start || range.end !== next[index].end
					);
				current = next;
				if (changed) {
					if (node.matches(':hover')) enter();
					if (node.matches(':focus-visible')) focus();
				}
			},
			destroy() {
				leave();
				blur();
				node.removeEventListener('pointerenter', enter);
				node.removeEventListener('pointerleave', leave);
				node.removeEventListener('focus', focus);
				node.removeEventListener('blur', blur);
				node.removeEventListener('pointerdown', pointerdown);
			}
		};
	}
	let descriptionLines = $derived(draft.description.split('\n').length);
	let descriptionWords = $derived(
		draft.description.trim() ? draft.description.trim().split(/\s+/u).length : 0
	);
	let descriptionCharacters = $derived(Array.from(draft.description).length);
	async function toggleDescriptionFullscreen() {
		const { selectionStart, selectionEnd, selectionDirection, scrollTop, scrollLeft } =
			descriptionInput;
		descriptionFullscreen = !descriptionFullscreen;
		await tick();
		descriptionInput.focus({ preventScroll: true });
		descriptionInput.setSelectionRange(selectionStart, selectionEnd, selectionDirection);
		descriptionInput.scrollTop = scrollTop;
		descriptionInput.scrollLeft = scrollLeft;
	}
	let descriptionSelection = $state('');
	let selectionDescription = '';
	let selectionIdentity: Core.identity | undefined;
	let selectionRevision = -1;
	let selectionStart = 0;
	let selectionEnd = 0;

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
		const annotation = formatted.match(/\((\w{3}), (today|[+-]?\d+d)\)$/);
		if (!annotation) return undefined;
		const today = Temporal.Instant.from(displayNow)
			.toZonedDateTimeISO(validZone(zone) ? zone : draft.context.browserTimeZone)
			.toPlainDate();
		return {
			month: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][
				Number(value.slice(5, 7)) - 1
			],
			day: String(Number(value.slice(8, 10))),
			year: value.slice(0, 4) === String(today.year) ? '' : value.slice(0, 4),
			weekday: annotation[1],
			delta: annotation[2] === 'today' ? '0d' : annotation[2]
		};
	}

	function captureDescriptionSelection() {
		descriptionSelection = descriptionInput.value.slice(
			descriptionInput.selectionStart,
			descriptionInput.selectionEnd
		);
		selectionDescription = draft.description;
		selectionIdentity = draft.identity;
		selectionRevision = draft.revision;
		selectionStart = descriptionInput.selectionStart;
		selectionEnd = descriptionInput.selectionEnd;
	}

	async function useSelectionAs(field: 'title' | 'location') {
		if (
			!descriptionSelection.trim() ||
			selectionDescription !== draft.description ||
			selectionIdentity !== draft.identity ||
			selectionRevision !== draft.revision ||
			descriptionInput.value !== selectionDescription ||
			descriptionInput.selectionStart !== selectionStart ||
			descriptionInput.selectionEnd !== selectionEnd ||
			descriptionInput.value.slice(selectionStart, selectionEnd) !== descriptionSelection
		)
			return;
		draft = Core.edit(draft, field, descriptionSelection);
		descriptionSelection = '';
		descriptionFullscreen = false;
		await tick();
		document.getElementById(field)?.focus();
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

	function importFormDetails(text: string) {
		clearEvidence();
		descriptionSelection = '';
		collapseDates();
		draft = Core.describe(draft, text);
		scheduleParse(true);
		void tick().then(() => {
			descriptionInput.focus({ preventScroll: true });
			descriptionInput.setSelectionRange(text.length, text.length);
		});
	}

	function includeSignup(identity: string, include: boolean, sheet?: string) {
		const link = links.find((candidate) => candidate.identity === identity);
		const source = signupSource(link?.veneerUrl ?? link?.href ?? '');
		if (!source) return;
		const text = setSignupLink(
			draft.description,
			include ? veneerLink(source, sheet) : undefined,
			source.id
		);
		clearEvidence();
		descriptionSelection = '';
		draft = Core.describe(draft, text);
		scheduleParse(true);
	}

	async function copyDescription() {
		const identity = draft.identity;
		const text = draft.description;
		try {
			await navigator.clipboard.writeText(text);
			if (draft.identity === identity)
				message =
					draft.description === text
						? 'Description copied.'
						: 'Previous description copied. Copy again for the latest text.';
		} catch {
			if (draft.identity === identity)
				message = 'Could not copy. Select the Description text and copy it manually.';
		}
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
		let mounted = true;
		collapseDates();
		trimOvernight = true;
		draft = Core.create(captureContext());
		ready = true;
		void tick().then(() => {
			if (!mounted || !descriptionInput.isConnected) return;
			if (
				document.activeElement !== document.body &&
				document.activeElement !== document.documentElement
			)
				return;
			descriptionInput.focus({ preventScroll: true });
			descriptionInput.setSelectionRange(
				descriptionInput.value.length,
				descriptionInput.value.length
			);
		});
		displayNow = draft.context.referenceInstant;
		const dayTimer = setInterval(() => {
			displayNow = new Date().toISOString();
		}, 60000);
		return () => {
			mounted = false;
			clearTimeout(parseTimer);
			clearInterval(dayTimer);
		};
	});

	function resetDraft() {
		// Ignore every completion from the discarded draft, including errors and cleanup.
		clipboardOperation += 1;
		readingClipboard = false;
		clearTimeout(parseTimer);
		descriptionSelection = '';
		collapseDates();
		trimOvernight = true;
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
			descriptionSelection = '';
			collapseDates();
			trimOvernight = true;
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
		const event = exportEvent;
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
	<header inert={descriptionFullscreen}>
		<h1>NL Event</h1>
	</header>
	<form class="workspace" onsubmit={(event) => event.preventDefault()}>
		<fieldset
			class="description-editor"
			class:fullscreen={descriptionFullscreen}
			role={descriptionFullscreen ? 'dialog' : undefined}
			aria-modal={descriptionFullscreen ? true : undefined}
			aria-label="Description editor"
			use:descriptionEditor={{
				value: draft.description,
				ranges: linkRange ? [linkRange] : textRange ? textPreviewRanges : evidenceRanges,
				hoverEvidence: previewText,
				selectedRanges: sourceHighlights.selected,
				unselectedRanges: sourceHighlights.unselected,
				reveal: linkRange ? linkHighlight : evidence,
				fullscreen: descriptionFullscreen,
				wrap: descriptionWrap,
				close: () => {
					void toggleDescriptionFullscreen();
				}
			}}
		>
			<legend class="description-legend"><label for="description">Description</label></legend>
			<div class="description-heading">
				<div class="description-actions">
					<button class="quiet-action" type="button" onclick={resetDraft} disabled={!ready}
						>Reset</button
					>
					<button
						class="quiet-action"
						type="button"
						onclick={copyDescription}
						disabled={!ready || !draft.description}>Copy description</button
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
			<div class="editor-surface">
				<textarea
					id="description"
					bind:this={descriptionInput}
					value={draft.description}
					onselect={captureDescriptionSelection}
					onfocus={clearEvidence}
					onbeforeinput={clearEvidence}
					oncompositionstart={clearEvidence}
					oninput={(event) => {
						clearEvidence();
						descriptionSelection = '';
						collapseDates();
						draft = Core.describe(draft, event.currentTarget.value);
						scheduleParse(event instanceof InputEvent && event.inputType === 'insertFromPaste');
					}}
					rows="1"
					wrap={descriptionWrap ? 'soft' : 'off'}
					aria-describedby="parse-status"
					disabled={!ready}></textarea>
				{#if descriptionSelection.trim()}
					<div class="selection-actions">
						{#each ['title', 'location'] as field (field)}
							<button
								class="inline outline"
								type="button"
								onpointerdown={(event) => {
									// Cancel mouse focus changes; WebKit touch needs its native click synthesis.
									if (event.pointerType === 'mouse') event.preventDefault();
								}}
								onclick={() => useSelectionAs(field as 'title' | 'location')}
							>
								Use selection as {field === 'title' ? 'Title' : 'Location'}
							</button>
						{/each}
					</div>
				{/if}
				<div class="editor-tools">
					<small class="editor-counts" data-tooltip="Lines, words, characters (including spaces)">
						<span class="sr-only"
							>{descriptionLines} lines, {descriptionWords} words, {descriptionCharacters} characters</span
						>
						<span aria-hidden="true"
							>{descriptionLines > 1 ? `${descriptionLines}L ` : ''}{descriptionWords}w {descriptionCharacters}c</span
						>
					</small>
					<button
						type="button"
						class="quiet-action editor-icon"
						aria-label="Word wrap"
						data-tooltip={`Word wrap: ${descriptionWrap ? 'on' : 'off'}`}
						aria-pressed={descriptionWrap}
						disabled={!ready}
						onclick={() => {
							descriptionWrap = !descriptionWrap;
						}}
					>
						<svg
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="1.7"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
						>
							<path d="M4 6h16M4 11h12a4 4 0 0 1 0 8h-5m3-3-3 3 3 3M4 16h3" />
						</svg>
					</button>
					<button
						type="button"
						class="quiet-action editor-icon"
						aria-label={descriptionFullscreen ? 'Restore editor' : 'Fullscreen editor'}
						data-tooltip={descriptionFullscreen ? 'Restore editor (Escape)' : 'Fullscreen editor'}
						aria-expanded={descriptionFullscreen}
						aria-controls="description"
						disabled={!ready}
						onclick={toggleDescriptionFullscreen}
					>
						<svg
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="1.7"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
						>
							{#if descriptionFullscreen}
								<path d="M9 3v6H3m12-6v6h6M9 21v-6H3m12 6v-6h6" />
							{:else}
								<path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6" />
							{/if}
						</svg>
					</button>
				</div>
			</div>
			{#key draft.identity}
				<AnnouncementLinks
					{links}
					original={draft.description}
					oninclude={includeSignup}
					onimport={importFormDetails}
					onhighlight={(link) => {
						linkHighlight = link
							? { description: draft.description, range: { start: link.start, end: link.end } }
							: undefined;
					}}
				/>
			{/key}

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
		</fieldset>
		<div class="event-details" inert={descriptionFullscreen}>
			{#each fields as { name, label, hint } (name)}
				{@const field = Core.getField(draft, name)}
				{@const fieldEvidence =
					name === 'start' || name === 'end'
						? ['date', 'time'].flatMap((part) =>
								Core.temporalOptions(draft, name, part as Core.temporalPart).flatMap(
									(option) => option.evidence ?? []
								)
							)
						: Core.alternatives(draft, name).flatMap((candidate) => candidate.textSpans ?? [])}
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
				<fieldset class="event-field" aria-label={label} inert={descriptionFullscreen}>
					<legend class="field-heading">
						<span class="field-label">
							<label
								for={name}
								class="evidence-label"
								use:chipEvidence={fieldEvidence}
								class:evidence-proxy={fieldEvidence.length > 0}>{label}</label
							>
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
						<label
							class="ownership"
							data-tooltip="On: use suggestions. Off: keep this field Manual."
						>
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
						value={name === 'end' && Core.inferredEndFollowsStart(draft)
							? result.endValue
							: (field.input ?? field.value)}
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
					{#each Core.partialLabels(draft, name) as label (label)}
						<small class="partial-evidence">{label}</small>
					{/each}
					{#if name === 'end'}
						{@const duration = Core.durationValue(draft)}
						<div class="temporal-options">
							<small class="part-label">
								<span class="evidence-label">Duration</span>
								{#if duration > 0}
									<span class="duration-summary"
										>· {Core.durationLabel(duration, result.allDay)}</span
									>
								{/if}
							</small>
							<ul class="suggestions part-options" aria-label="End/Duration duration alternatives">
								{#each Core.durationOptions(draft) as option (option.amount)}
									<li>
										<button
											type="button"
											class="suggestion part-option"
											use:chipEvidence={[]}
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
							{@const partEvidence = options.flatMap((option) => option.evidence ?? [])}
							{@const collapsible = part === 'date' && options.length >= 5}
							{@const visibleOptions =
								collapsible && !expandedDates[name]
									? options.filter((option, index) => index < 3 || option.selected)
									: options}
							{@const hiddenCount = options.length - visibleOptions.length}
							{@const hiddenEvidence = hiddenCount
								? options
										.slice(3)
										.filter((option) => !option.selected)
										.flatMap((option) => option.evidence ?? [])
								: []}
							{@const dateLabels =
								part === 'date'
									? options
											.filter((option) => !option.generated)
											.map((option) => displayDateOption(option.value))
									: []}
							{@const hasYear = dateLabels.some((label) => label?.year)}
							{@const deltaWidth = Math.max(
								4,
								...dateLabels.map((label) => label?.delta.length ?? 0)
							)}
							{#if options.length || part === 'time'}
								<div class="temporal-options">
									<small class="part-label">
										<span
											class="evidence-label"
											use:chipEvidence={partEvidence}
											class:evidence-proxy={partEvidence.length > 0}
											>{part === 'date' ? 'Date' : 'Time'}</span
										>
										{#if collapsible}
											<button
												type="button"
												class="quiet-action date-toggle"
												use:chipEvidence={hiddenEvidence}
												class:evidence-proxy={hiddenEvidence.length > 0}
												class:evidence-hovered={matchesTextEvidence(hiddenEvidence)}
												aria-expanded={expandedDates[name]}
												aria-controls={`${name}-date-options`}
												onclick={() => {
													clearEvidence();
													expandedDates[name] = !expandedDates[name];
												}}>{expandedDates[name] ? 'Show fewer' : `Show ${hiddenCount} more`}</button
											>
										{/if}
										{#if part === 'time' && pairingWarning}<span
												class="pairing-warning"
												data-tooltip="This date and time were not paired in Description."
												>Not paired in source</span
											>{/if}
									</small>
									<ul
										class="suggestions part-options"
										class:with-date-year={hasYear}
										style:--date-delta-width={`${deltaWidth}ch`}
										id={`${name}-${part}-options`}
										aria-label={`${label} ${part} alternatives`}
									>
										{#if part === 'time'}
											<li>
												<button
													type="button"
													class="suggestion part-option"
													use:chipEvidence={[]}
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
										{#each visibleOptions as option (option.value)}
											{@const dateLabel =
												part === 'date' && !option.generated
													? displayDateOption(option.value)
													: undefined}
											<li>
												<button
													type="button"
													class="suggestion part-option"
													use:chipEvidence={option.evidence}
													class:source-backed={(option.evidence?.length ?? 0) > 0}
													class:evidence-hovered={matchesTextEvidence(option.evidence)}
													class:unpaired={option.paired === false}
													aria-label={option.label}
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
													{#if dateLabel}
														<span class="date-chip-label">
															<span>{dateLabel.month}</span>
															<span class="date-day">{dateLabel.day}</span>
															{#if hasYear}<span>{dateLabel.year}</span>{/if}
															<span class="date-annotation">
																<span>{dateLabel.weekday}</span>
																<span class="date-delta">{dateLabel.delta}</span>
															</span>
														</span>
													{:else}
														<span>{option.generated ? option.label : option.value}</span>
													{/if}
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
										use:chipEvidence={candidate.textSpans ?? []}
										class:source-backed={(candidate.textSpans?.length ?? 0) > 0}
										class:evidence-hovered={matchesTextEvidence(candidate.textSpans)}
										aria-pressed={candidateSelected(name, candidate)}
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
					{#if name === 'end'}
						{#if ready && overnight.eligible}
							<div class="overnight-export">
								<div class="overnight-control">
									<label
										><input type="checkbox" bind:checked={trimOvernight} /> Trim overnight tail</label
									>

									<details class="overnight-help no-nimble">
										<summary aria-label="About trimming overnight tail"
											><span aria-hidden="true">?</span></summary
										>
										<p>
											Avoid an extra final-morning entry in Google Calendar's Schedule view. For
											events ending by 6 AM, exports stop at midnight on the final day. Hours after
											midnight won't be marked busy. The actual end stays in the regular export
											description; Open without description omits it.
										</p>
									</details>
									<small
										class="calendar-end"
										class:preview-hidden={!trimOvernight}
										aria-hidden={!trimOvernight}>Calendar end: {overnight.calendarEnd}</small
									>
								</div>
							</div>
						{/if}
						{#if overnight.warning}<small role="status">{overnight.warning}</small>{/if}
					{/if}
				</fieldset>
			{/each}
			<dialog
				bind:this={zoneDialog}
				aria-labelledby="zone-dialog-title"
				onclose={() => {
					if (
						document.activeElement === document.body ||
						zoneDialog.contains(document.activeElement)
					) {
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
			{#if longGoogleUrl}<p role="status">
					This Google Calendar URL is unusually long ({googleUrl.length.toLocaleString()} characters).
					If it fails to open, download .ics for the full description, or copy the description and open
					without it.
				</p>{/if}
			<div class="actions">
				{#if ready && exportEvent}
					<!-- External calendar URL; this is not a SvelteKit route. -->
					<!-- eslint-disable svelte/no-navigation-without-resolve -->
					<a class="nc-button" href={googleUrl} target="_blank" rel="noopener noreferrer"
						>Open in Google Calendar</a
					>
					<a
						class="nc-button secondary"
						href={Core.googleUrl({ ...exportEvent, description: '' })}
						target="_blank"
						rel="noopener noreferrer">Open without description</a
					>
					<!-- eslint-enable svelte/no-navigation-without-resolve -->
				{:else}
					<button type="button" disabled>Open in Google Calendar</button>
				{/if}
				<button
					class="secondary"
					type="button"
					onclick={download}
					disabled={!ready || !result.event}>Download .ics</button
				>
			</div>
			<p>
				Google Calendar opens an editable form. Finish saving there. Exporting keeps this draft.
			</p>
			<p>
				Long descriptions can exceed browser URL limits and appear in browser history. Download .ics
				to keep the full text in a file.
			</p>
		</div>
	</form>
</main>

<style>
	.overnight-export {
		margin-top: 0.75rem;
		font-size: 0.85rem;
	}
	.overnight-control {
		position: relative;
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.3rem;
	}
	.overnight-control label {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin: 0 0 0 0.2rem;
		white-space: nowrap;
		cursor: pointer;
	}
	.overnight-control input {
		margin: 0;
	}
	.overnight-help {
		position: static;
		margin: 0;
		padding: 0;
		border: 0;
	}
	.overnight-help summary {
		margin: 0;
		display: grid;
		place-items: center;
		width: 1.5rem;
		height: 2rem;
		padding: 0;
		cursor: pointer;
	}
	.overnight-help summary span {
		display: grid;
		place-items: center;
		width: 1rem;
		height: 1rem;
		font-size: 0.7rem;
		border: 1px solid var(--nc-border);
		border-radius: 50%;
	}
	.overnight-help summary::marker {
		content: '';
	}
	.overnight-help p {
		position: absolute;
		z-index: 20;
		left: 0;
		top: 100%;
		width: min(22rem, 100%);
		box-sizing: border-box;
		margin: 0.4rem 0 0;
		padding: 0.75rem;
		border: 1px solid var(--nc-border);
		border-radius: 0.4rem;
		background: var(--nc-surface-1);
		box-shadow: 0 2px 8px #0003;
	}
	.calendar-end {
		margin-left: auto;
		font-size: 0.7rem;
		white-space: nowrap;
	}
	.preview-hidden {
		visibility: hidden;
	}
	@media (any-pointer: coarse) {
		.overnight-control label {
			font-size: 0.8rem;
		}
		.overnight-help summary {
			min-width: 1.5rem;
			min-height: 2.75rem;
		}
	}

	.description-editor {
		min-width: 0;
		margin: 0;
		padding: 0.75rem;
		border: 1px solid var(--nc-border);
		border-radius: 0.4rem;
	}
	.description-legend {
		padding-inline: 0.3rem;
		font-weight: 700;
	}
	.description-legend label {
		margin: 0;
	}

	.editor-surface {
		position: relative;
		min-width: 0;
		margin-block: 0.5rem;
		border: 1px solid var(--nc-border);
		border-radius: var(--nc-radius);
		background: var(--nc-surface-1);
		display: flex;
		flex-direction: column;
	}
	.editor-surface:focus-within {
		border-color: var(--nc-primary);
		box-shadow: 0 0 0 2px var(--nc-primary-focus);
	}
	.description-editor textarea {
		position: relative;
		z-index: 1;
		display: block;
		min-height: 0;
		margin: 0;
		border: 0;
		border-radius: inherit;
		background: transparent;
		resize: none;
		line-height: 1.5;
		overflow: auto;
	}
	.description-editor textarea:focus {
		box-shadow: none;
		outline: none;
	}
	.editor-tools {
		display: flex;
		align-items: center;
		gap: 0.125rem;
		padding: 0.125rem 0.375rem;
		border-top: 1px solid color-mix(in srgb, var(--nc-border) 45%, transparent);
		flex-shrink: 0;
	}
	.editor-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		padding: 0.25rem;
		border-radius: 0.25rem;
		flex-shrink: 0;
	}
	.editor-icon svg {
		width: 1rem;
		height: 1rem;
	}
	.editor-icon[aria-pressed='true'] {
		opacity: 1;
		color: var(--nc-primary);
		background: var(--nc-surface-2);
	}
	.editor-counts {
		margin-inline-end: auto;
		padding-inline: 0.25rem;
		opacity: 0.65;
		font-size: 0.7rem;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
	.selection-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.5rem;
		flex-shrink: 0;
		margin: 0.25rem 0.75rem;
	}
	.selection-actions button {
		font-size: 0.8rem;
	}
	@media (any-pointer: coarse) {
		.editor-icon {
			width: 2.75rem;
			height: 2.75rem;
		}
	}
	.fullscreen .editor-surface {
		flex: 1 1 auto;
		min-height: 5rem;
	}
	.description-editor.fullscreen {
		position: fixed;
		z-index: 100;
		top: var(--editor-top, 0px);
		left: var(--editor-left, 0px);
		width: var(--editor-width, 100%);
		height: var(--editor-height, 100dvh);
		box-sizing: border-box;
		padding: max(0.75rem, env(safe-area-inset-top)) max(0.75rem, env(safe-area-inset-right))
			max(0.75rem, env(safe-area-inset-bottom)) max(0.75rem, env(safe-area-inset-left));
		background: Canvas;
		color: CanvasText;
		display: flex;
		flex-direction: column;
		overflow: auto;
		overscroll-behavior: contain;
	}
	.fullscreen textarea {
		flex: 1 1 auto;
		height: 0;
		min-height: 3rem;
	}
	.fullscreen .description-heading,
	.fullscreen .editor-tools {
		flex-shrink: 0;
	}

	:global(html) {
		scrollbar-gutter: stable;
		--evidence-preview-color: #5b2182;
	}
	main {
		--evidence-selected-bg: rgb(40 170 125 / 24%);
		--evidence-unselected-bg: rgb(100 130 190 / 12%);
		width: 100%;
		min-width: 0;
		box-sizing: border-box;
		max-width: 46rem;
		margin: 0 auto;
		padding: 1rem;
	}
	.event-details {
		min-width: 0;
	}
	/* 30rem editor + 42rem form + 1.25rem gap + 2rem gutters, with scrollbar room. */
	@media (min-width: 77rem) and (min-height: 32rem) {
		:global(body) {
			/* main owns the bottom gutter. Extra space outside the grid would push
			   the sticky editor above its top inset at the end of document scrolling. */
			padding-block-end: 0;
		}
		main {
			/* Escape nimble's narrow body content column before sizing our workspace. */
			grid-column: 1 / -1;
			max-width: 95.25rem;
		}
		.workspace {
			/* Keep the sticky boundary aligned with main's single bottom gutter. */
			margin-block-end: 0;
			display: grid;
			grid-template-columns: 42rem minmax(30rem, 50rem);
			gap: 1.25rem;
			align-items: start;
		}
		.event-details {
			grid-column: 1;
			grid-row: 1;
		}
		.event-details > .event-field:first-child {
			margin-block-start: 0;
		}
		.description-editor:not(.fullscreen) {
			grid-column: 2;
			grid-row: 1;
			--editor-fill: 1;
			position: sticky;
			top: 1rem;
			height: var(--editor-pane-height, calc(100dvh - 2rem));
			display: flex;
			flex-direction: column;
			/* Let oversized status/selection controls remain reachable at large text sizes. */
			overflow: auto;
		}
		.description-editor:not(.fullscreen) .editor-surface {
			flex: 1 1 auto;
			min-height: 8rem;
		}
		.description-editor:not(.fullscreen) textarea {
			flex: 1 1 auto;
			height: 0;
			min-height: 3rem;
		}
		.description-editor:not(.fullscreen) > :not(.editor-surface) {
			flex-shrink: 0;
		}
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
		/* Reserve room for outlines inside the scrolling chip list. */
		padding: 3px;
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
	.date-toggle {
		font: inherit;
		text-decoration: underline;
		text-underline-offset: 0.15em;
	}
	.date-toggle.evidence-proxy:is(:hover, :focus-visible),
	.date-toggle.evidence-hovered,
	.evidence-label.evidence-proxy:hover {
		opacity: 1;
		background: var(--evidence-unselected-bg);
		outline: 2px dashed var(--evidence-preview-color);
		outline-offset: 1px;
	}
	.evidence-label {
		font-weight: 700;
	}
	.date-chip-label {
		display: inline-grid;
		align-items: baseline;
		grid-template-columns: 3ch 2ch auto;
		column-gap: 0.5ch;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-variant-numeric: tabular-nums;
	}
	.with-date-year .date-chip-label {
		grid-template-columns: 3ch 2ch 4ch auto;
	}
	.date-day,
	.date-delta {
		text-align: right;
	}
	.date-annotation {
		display: inline-grid;
		grid-template-columns: 3ch var(--date-delta-width);
		column-gap: 0.35ch;
		margin-inline-start: 0.75ch;
		font-size: 0.8em;
		opacity: 0.55;
	}
	.pairing-warning {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	:global(.fast-tooltip) {
		position: fixed;
		z-index: 10000;
		pointer-events: auto;
		overscroll-behavior: contain;
		max-width: min(24rem, calc(100vw - 16px));
		box-sizing: border-box;
		padding: 0.35rem 0.55rem;
		border-radius: 0.3rem;
		background: var(--evidence-preview-color);
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
		gap: 0.375rem;
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
	.suggestion.source-backed {
		background: var(--evidence-unselected-bg);
	}
	.suggestion.source-backed[aria-pressed='true'] {
		background: var(--evidence-selected-bg);
	}
	.suggestion.source-backed:not(:disabled):is(:hover, :focus-visible),
	.suggestion.source-backed.evidence-hovered {
		outline: 2px dashed var(--evidence-preview-color);
		outline-offset: 1px;
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
