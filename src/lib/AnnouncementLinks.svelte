<script lang="ts">
	import { onDestroy, tick, untrack } from 'svelte';
	import type { AnnouncementLink } from './announcementLinks';
	import {
		formIntroduction,
		sheetIdentity,
		signupSource,
		trackFormIntroduction,
		writeFormIntroduction,
		type FormIntroductionSection,
		type FormMetadata
	} from './calendarDescription';
	import { loadFormMetadata } from './formMetadata';

	let {
		links,
		original,
		oninclude,
		onimport,
		onhighlight
	}: {
		links: AnnouncementLink[];
		original: string;
		oninclude: (identity: string, include: boolean, sheet?: string) => void;
		onimport: (text: string) => void;
		onhighlight: (link?: AnnouncementLink) => void;
	} = $props();
	const detailsId = $props.id();
	let panel = $state<HTMLDivElement>();
	let trigger: HTMLButtonElement | undefined;
	let selected = $state<AnnouncementLink>();
	let metadata = $state<FormMetadata>();
	let phase = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
	let failure = $state('');
	let imported = $state<FormIntroductionSection>();
	let trackedDescription = '';
	let confirmReplacement = $state(false);
	let generation = 0;
	let disposed = false;
	let source = $derived(signupSource(selected?.href ?? ''));
	let intro = $derived(metadata?.type === 'form' ? formIntroduction(metadata) : '');
	let alreadyUsed = $derived(!!intro && imported?.text === intro);
	let edited = $derived(
		!!imported && original.slice(imported.start, imported.end) !== imported.text
	);
	let included = $derived(links.find((link) => link.identity === selected?.identity)?.veneerUrl);
	let sheet = $derived(included ? (new URL(included).pathname.split('/')[2] ?? '') : '');
	let sheets = $derived([
		...new Map([
			...(sheet ? [[sheet, { id: sheet, label: sheet }] as const] : []),
			...(metadata?.autoSheets ?? []).map(
				({ veneerId, title }) => [veneerId, { id: veneerId, label: title || veneerId }] as const
			),
			...links.flatMap((link) => {
				const id = sheetIdentity(link.href);
				return id ? [[id, { id, label: link.source }] as const] : [];
			})
		]).values()
	]);
	$effect(() => {
		if (selected && !links.some((link) => link.identity === selected?.identity)) dismiss();
	});
	$effect(() => {
		const text = original;
		untrack(() => {
			imported = trackFormIntroduction(trackedDescription, text, imported);
			trackedDescription = text;
			confirmReplacement = false;
		});
	});
	onDestroy(() => {
		disposed = true;
		generation++;
		onhighlight();
	});

	async function show(link: AnnouncementLink, button = trigger, refresh = false) {
		confirmReplacement = false;
		trigger = button;
		const same = selected?.identity === link.identity;
		if (same && !refresh && phase !== 'error') {
			selected = link;
			await tick();
			panel?.focus({ preventScroll: true });
			panel?.scrollIntoView({ block: 'nearest' });
			return;
		}
		if (!same) metadata = undefined;
		selected = link;
		const token = ++generation;
		const target = signupSource(link.href);
		const shouldLoad = !!target && (!same || refresh || phase === 'error');
		if (shouldLoad) {
			phase = 'loading';
			failure = '';
		} else if (!target) phase = 'idle';
		await tick();
		if (disposed || token !== generation) return;
		if (!refresh) {
			panel?.focus({ preventScroll: true });
			panel?.scrollIntoView({ block: 'nearest' });
		}
		if (!shouldLoad || !target) return;
		try {
			const result = await loadFormMetadata(target.id, refresh);
			if (
				disposed ||
				token !== generation ||
				!links.some((candidate) => candidate.identity === link.identity)
			)
				return;
			metadata = result;
			phase = 'ready';
		} catch (error) {
			if (disposed || token !== generation) return;
			failure = error instanceof Error ? error.message : 'Could not get event details.';
			phase = 'error';
		}
	}
	function dismiss(restoreFocus = false) {
		confirmReplacement = false;
		generation++;
		selected = undefined;
		metadata = undefined;
		phase = 'idle';
		onhighlight();
		if (restoreFocus && trigger?.isConnected) trigger.focus({ preventScroll: true });
	}
	function addDetails(replaceEdited = false) {
		if (!selected || !intro || alreadyUsed) return;
		if (edited && !replaceEdited) {
			confirmReplacement = true;
			return;
		}
		const result = writeFormIntroduction(original, intro, imported);
		imported = result.section;
		trackedDescription = result.description;
		dismiss();
		onimport(result.description);
	}
</script>

<svelte:window
	onkeydowncapture={(event) => {
		if (event.key === 'Escape' && panel?.contains(event.target as Node)) {
			event.preventDefault();
			dismiss(true);
		}
	}}
/>

{#if links.length}
	<div class="link-chips" role="group" aria-label="Description links">
		{#each links as link (link.identity)}
			<button
				type="button"
				class="link-chip"
				class:included={!!link.veneerUrl}
				aria-label={`Details for ${link.source}`}
				aria-controls={detailsId}
				aria-expanded={selected?.identity === link.identity}
				title={signupSource(link.href) ? `Get details via Veneer: ${link.source}` : link.source}
				onpointerenter={() => onhighlight(link)}
				onpointerleave={() => onhighlight()}
				onfocus={() => onhighlight(link)}
				onblur={() => onhighlight()}
				onclick={(event) => show(link, event.currentTarget)}
			>
				<span class="chip-kind">{link.kind}</span><span class="chip-url"
					>{link.source.replace(/^https?:\/\//i, '')}</span
				>
				{#if link.veneerUrl}<span class="signup-badge">Veneer</span>{/if}
			</button>
		{/each}
	</div>
{/if}
{#if selected}
	<div
		id={detailsId}
		bind:this={panel}
		class="link-details"
		role="region"
		aria-label="Link details"
		tabindex="-1"
		aria-busy={phase === 'loading'}
	>
		<div class="details-heading">
			<strong>Link details</strong><button
				type="button"
				class="quiet"
				aria-label="Close link details"
				onclick={() => dismiss(true)}>Close</button
			>
		</div>
		<p class="details-url">
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
			<a href={selected.href} target="_blank" rel="noopener noreferrer">{selected.source}</a>
		</p>
		<div class="link-actions">
			{#if source}
				<label
					><input
						type="checkbox"
						checked={!!included}
						onchange={(event) =>
							selected && oninclude(selected.identity, event.currentTarget.checked)}
					/> Veneer link</label
				>
			{/if}
			{#if intro}<button
					type="button"
					class="inline outline"
					disabled={alreadyUsed || phase === 'loading'}
					onclick={() => addDetails()}
					>{alreadyUsed
						? 'Already added'
						: imported
							? edited
								? 'Review replacement'
								: 'Update description'
							: 'Add to description'}</button
				>{/if}
			{#if source && phase !== 'loading'}<button
					type="button"
					class="quiet"
					onclick={() => selected && show(selected, trigger, true)}
					>{phase === 'error' ? 'Retry' : 'Refresh'}</button
				>{/if}
		</div>
		{#if confirmReplacement}
			<div role="group" aria-label="Replace edited Form details">
				<p>The imported details were edited. Replace that section with the current Form details?</p>
				<button type="button" class="quiet" onclick={() => (confirmReplacement = false)}
					>Keep edits</button
				>
				<button type="button" class="inline outline" onclick={() => addDetails(true)}
					>Replace edited details</button
				>
			</div>
		{/if}
		{#if phase === 'loading'}<p role="status">Getting event details...</p>{/if}
		{#if phase === 'error'}<p role="alert">{failure}</p>{/if}
		{#if metadata?.type === 'sheet'}<p>This link opens a Sheet, without Form details.</p>{/if}
		{#if metadata?.type === 'form' && !intro}<p>No introductory details were found.</p>{/if}
		{#if intro}<pre aria-label="Form details preview">{intro}</pre>{/if}

		{#if source && included && sheets.length}
			<details class="secondary-details">
				<summary>Confirmation Sheet</summary>
				{#if sheets.length}<select
						aria-label="Confirmation Sheet"
						value={sheet}
						onchange={(event) =>
							selected && oninclude(selected.identity, true, event.currentTarget.value)}
					>
						<option value="">Automatic</option>
						{#each sheets as candidate (candidate.id)}<option value={candidate.id}
								>{candidate.label}</option
							>{/each}
					</select>{/if}
			</details>
		{/if}
		{#if selected.equivalents?.length}
			<details class="secondary-details">
				<summary>Equivalent links ({selected.equivalents.length})</summary>
				{#each selected.equivalents as equivalent (equivalent.href)}
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
					<a href={equivalent.href} target="_blank" rel="noopener noreferrer">{equivalent.source}</a
					>
				{/each}
			</details>
		{/if}
	</div>
{/if}

<style>
	.link-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-block: 0.5rem;
	}
	.link-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		max-width: min(100%, 20rem);
		min-width: 0;
		min-height: 2rem;
		margin: 0;
		padding: 0.25rem 0.6rem;
		border: 1px solid var(--nc-border);
		border-radius: 1rem;
		background: transparent;
		color: inherit;
		font-size: 0.8rem;
		font-weight: 400;
	}
	.link-chip:hover,
	.link-chip[aria-expanded='true'] {
		background: color-mix(in srgb, currentColor 7%, transparent);
	}
	.link-chip.included {
		border-color: var(--nc-primary);
	}
	.chip-kind {
		opacity: 0.65;
		flex-shrink: 0;
	}
	.chip-url {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.signup-badge {
		font-size: 0.7rem;
		flex-shrink: 0;
	}
	.link-details {
		min-width: 0;
		margin-block: 0.75rem;
		padding: 0.75rem;
		border: 1px solid var(--nc-border);
		border-radius: 0.4rem;
	}
	.details-heading,
	.link-actions {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
	}
	.details-heading {
		justify-content: space-between;
	}
	.details-url {
		font-size: 0.75rem;
		opacity: 0.65;
		overflow-wrap: anywhere;
		margin-block: 0.5rem;
	}
	.link-actions {
		font-size: 0.85rem;
	}
	.link-actions label {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin: 0;
		cursor: pointer;
	}
	.link-actions input {
		margin: 0;
	}
	.link-details pre {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		max-height: 13rem;
		overflow: auto;
		margin-block: 0.75rem;
		font: inherit;
		font-size: 0.9rem;
		user-select: text;
	}
	.quiet {
		margin: 0;
		padding: 0.25rem 0.4rem;
		border: 0;
		background: transparent;
		color: inherit;
		font-size: 0.8rem;
		font-weight: 400;
		text-decoration: underline;
	}
	.secondary-details {
		margin-top: 0.5rem;
		font-size: 0.8rem;
	}
	.secondary-details a {
		display: block;
		overflow-wrap: anywhere;
	}
	select {
		width: 100%;
		box-sizing: border-box;
	}
	summary {
		cursor: pointer;
	}
	@media (any-pointer: coarse) {
		.link-chip,
		.details-url a,
		.link-actions label,
		summary,
		.quiet {
			min-height: 2.75rem;
			align-content: center;
		}
	}
</style>
