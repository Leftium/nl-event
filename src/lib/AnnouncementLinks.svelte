<script lang="ts">
	import { discoverLinks, primarySignup } from './announcementLinks';
	let { description }: { description: string } = $props();
	let links = $derived(discoverLinks(description));
	let explicit = $state<string | null>();
	let selected = $derived(primarySignup(links, explicit));
	let dialog: HTMLDialogElement;
	let trigger = $state<HTMLButtonElement>();
	let backdropPointer = false;
	const groups = ['Signup and confirmation', 'Map', 'Other'] as const;
	const groupFor = (link: (typeof links)[number]) =>
		link.kind === 'Map'
			? 'Map'
			: link.kind !== 'Other' ||
				  link.roles.includes('Signup') ||
				  link.roles.includes('Confirmation')
				? 'Signup and confirmation'
				: 'Other';
	$effect(() => {
		if (explicit && !links.some((link) => link.identity === explicit)) explicit = undefined;
		if (!links.length) explicit = undefined;
		if (!links.length && dialog?.open) dialog.close();
	});
	function close() {
		dialog.close();
	}
	function keepDialogFocus(event: KeyboardEvent) {
		if (event.key !== 'Tab' || event.isComposing) return;
		const controls = [
			...dialog.querySelectorAll<HTMLElement>('button, input:checked, a[href], summary')
		];
		const first = controls[0];
		const last = controls.at(-1);
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last?.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first?.focus();
		}
	}
</script>

{#if links.length}
	<button
		bind:this={trigger}
		class="links-trigger"
		type="button"
		aria-haspopup="dialog"
		onclick={() => dialog.showModal()}>Links ({links.length})</button
	>
{/if}
<dialog
	bind:this={dialog}
	aria-labelledby="links-title"
	aria-describedby="links-help"
	onkeydown={keepDialogFocus}
	onclose={() => trigger?.focus({ preventScroll: true })}
	onpointerdown={(event) => {
		backdropPointer = event.target === dialog;
	}}
	onclick={(event) => {
		if (event.target === dialog && backdropPointer) close();
		backdropPointer = false;
	}}
>
	<div class="dialog-content">
		<div class="dialog-heading">
			<h2 id="links-title">Description links</h2>
			<button class="close-icon" type="button" aria-label="Close" onclick={close}>
				<svg
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.7"
					stroke-linecap="round"
					aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg
				>
			</button>
		</div>
		<p id="links-help">Choose a primary signup link. Discovery stays on this device.</p>
		<fieldset>
			<legend class="sr-only">Primary signup</legend>
			<label class="no-selection"
				><input
					type="radio"
					name="primary-signup"
					checked={!selected}
					onchange={() => {
						explicit = null;
					}}
				/> None selected</label
			>
			{#each groups as group (group)}
				{@const entries = links.filter((link) => groupFor(link) === group)}
				{#if entries.length}
					<h3>{group}</h3>
					<ul>
						{#each entries as link (link.identity)}
							<li class:selected={selected === link.identity}>
								<div class="link-heading">
									{#if !link.sheet && link.kind !== 'Map'}
										<label class="link-choice">
											<input
												type="radio"
												name="primary-signup"
												checked={selected === link.identity}
												onchange={() => {
													explicit = link.identity;
												}}
											/>
											<span class="sr-only"
												>{selected === link.identity ? 'Primary signup' : 'Use as signup'}</span
											>
											<span class="link-kind" aria-hidden="true">{link.kind}</span>
										</label>
									{:else}
										<span class="link-kind">{link.kind}</span>
									{/if}
									<!-- Discovery only emits absolute HTTP(S) URLs, outside the app router. -->
									<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
									<a href={link.href} target="_blank" rel="noopener noreferrer" title={link.source}
										>{link.source.replace(/^https?:\/\//i, '')}<span class="sr-only">
											(opens in a new tab)</span
										></a
									>
									{#if selected === link.identity}<span class="primary-label">Primary</span>{/if}
								</div>
								<details>
									<summary>Details</summary>
									{#if link.roles.length}<p>Suggested: {link.roles.join(', ')}</p>{/if}
									{#if link.sheet}<p>
											Confirmation fallback candidate. Veneer can discover a Form-linked Sheet
											first.
										</p>{/if}
									{#if link.kind === 'Short link' || (link.kind === 'Veneer' && !link.form && !link.sheet)}<p
										>
											Destination unknown until resolved.
										</p>{/if}
									<p>{link.source}</p>
									<blockquote>{link.context}</blockquote>
								</details>
							</li>
						{/each}
					</ul>
				{/if}
			{/each}
		</fieldset>
	</div>
</dialog>

<style>
	.links-trigger {
		border: 0;
		background: transparent;
		color: inherit;
		padding: 0;
		font-size: 0.8rem;
		text-decoration: underline;
		cursor: pointer;
	}
	dialog {
		width: min(38rem, calc(100% - 1.5rem));
		max-height: calc(100dvh - 2rem);
		box-sizing: border-box;
		padding: 0;
		overflow: auto;
		overscroll-behavior: contain;
		border: 1px solid var(--nc-border);
		border-radius: 0.5rem;
		background: var(--nc-surface-1, Canvas);
		color: inherit;
	}
	dialog::backdrop {
		background: rgb(0 0 0 / 45%);
	}
	.dialog-content {
		padding: 1rem;
	}
	.dialog-heading {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}
	h2 {
		margin: 0;
		font-size: 1.25rem;
	}
	h3 {
		margin-block: 1rem 0.25rem;
		font-size: 0.75rem;
		font-weight: 500;
		color: color-mix(in srgb, currentColor 65%, transparent);
	}
	fieldset {
		min-width: 0;
		margin: 0;
		padding: 0;
		border: 0;
	}
	legend {
		font-weight: bold;
	}
	ul {
		list-style: none;
		padding: 0;
		margin: 0;
	}
	li {
		min-width: 0;
		padding: 0.3rem 0.5rem;
		border-radius: 0.2rem;
		font-size: 0.875rem;
	}
	label {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0;
		min-height: 1.75rem;
		cursor: pointer;
	}
	input {
		margin: 0;
	}
	a {
		display: block;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	details {
		margin-top: 0;
		font-size: 0.75rem;
		color: color-mix(in srgb, currentColor 65%, transparent);
	}
	details p,
	blockquote {
		overflow-wrap: anywhere;
		white-space: pre-wrap;
		margin: 0.5rem 0;
	}
	summary {
		cursor: pointer;
		min-height: 1.25rem;
	}
	#links-help {
		font-size: 0.8rem;
		color: color-mix(in srgb, currentColor 65%, transparent);
		margin-block: 0.5rem;
	}
	.close-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		padding: 0.35rem;
		margin: 0;
		border: 0;
		background: transparent;
		box-shadow: none;
		color: inherit;
	}
	.close-icon svg {
		width: 1.1rem;
		height: 1.1rem;
	}
	.close-icon:hover,
	li:hover {
		background: color-mix(in srgb, currentColor 4%, transparent);
	}
	li.selected {
		background: color-mix(in srgb, currentColor 7%, transparent);
	}
	.link-heading {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		min-width: 0;
	}
	.link-choice,
	.link-kind,
	.primary-label {
		flex-shrink: 0;
	}
	.link-kind {
		font-weight: 400;
		color: color-mix(in srgb, currentColor 65%, transparent);
	}
	.link-heading a {
		flex: 1;
		min-width: 0;
		color: inherit;
		text-decoration-color: color-mix(in srgb, currentColor 25%, transparent);
		text-underline-offset: 0.15em;
	}
	.primary-label {
		font-size: 0.7rem;
		color: color-mix(in srgb, currentColor 65%, transparent);
	}
	@media (any-pointer: coarse) {
		.close-icon {
			width: 2.75rem;
			height: 2.75rem;
		}
		label,
		summary {
			min-height: 2.75rem;
		}
		summary {
			align-content: center;
		}
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
