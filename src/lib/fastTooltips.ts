export function fastTooltips(root: HTMLElement) {
	let active: HTMLElement | null = null;
	let tooltip: HTMLDivElement | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let described: HTMLElement | null = null;
	function hide() {
		clearTimeout(timer);
		tooltip?.remove();
		tooltip = undefined;
		if (described) {
			const ids = (described.getAttribute('aria-describedby') ?? '')
				.split(/\s+/)
				.filter((id) => id && id !== 'field-tooltip');
			if (ids.length) described.setAttribute('aria-describedby', ids.join(' '));
			else described.removeAttribute('aria-describedby');
		}
		described = null;
		active = null;
	}
	function show(event: Event) {
		const target = (event.target as Element).closest<HTMLElement>('[data-tooltip]');
		if (target === active && event.type !== 'focusin') return;
		hide();
		if (!target || !target.dataset.tooltip) return;
		active = target;
		described = event.type === 'focusin' ? (event.target as HTMLElement) : target;
		timer = setTimeout(
			() => {
				if (!target.isConnected || !described?.isConnected) {
					hide();
					return;
				}
				tooltip = document.createElement('div');
				tooltip.id = 'field-tooltip';
				tooltip.className = 'fast-tooltip';
				tooltip.role = 'tooltip';
				tooltip.textContent = target.dataset.tooltip ?? '';
				// Keep dialog tooltips in the modal's top layer.
				(target.closest('dialog') ?? document.body).append(tooltip);
				described.setAttribute(
					'aria-describedby',
					[described.getAttribute('aria-describedby'), tooltip.id].filter(Boolean).join(' ')
				);
				const box = target.getBoundingClientRect();
				const viewport = window.visualViewport;
				let left = (viewport?.offsetLeft ?? 0) + 8;
				let right =
					Math.min(
						document.documentElement.clientWidth,
						(viewport?.offsetLeft ?? 0) + (viewport?.width ?? innerWidth)
					) - 8;
				const top = (viewport?.offsetTop ?? 0) + 8;
				const bottom = (viewport?.offsetTop ?? 0) + (viewport?.height ?? innerHeight) - 8;
				const pane = target.closest('.event-details');
				const editor = root.querySelector('.description-editor');
				if (pane && editor && target.matches('.suggestion')) {
					const formBox = pane.getBoundingClientRect();
					const editorBox = editor.getBoundingClientRect();
					// Measured side-by-side geometry also handles zoom and short layouts.
					if (formBox.right <= editorBox.left && editorBox.width > 0) {
						left = Math.max(left, formBox.left + 8);
						right = Math.min(right, formBox.right - 8);
					}
				}
				tooltip.style.maxWidth = `min(24rem, ${Math.max(1, right - left)}px)`;
				tooltip.style.maxHeight = `${Math.max(1, bottom - top)}px`;
				tooltip.style.overflowY = 'auto';
				const size = tooltip.getBoundingClientRect();
				tooltip.style.left = `${Math.max(left, Math.min(box.left, right - size.width))}px`;
				const preferredTop =
					box.bottom + size.height + 6 <= bottom ? box.bottom + 6 : box.top - size.height - 6;
				tooltip.style.top = `${Math.max(top, Math.min(preferredTop, bottom - size.height))}px`;
			},
			event.type === 'focusin' ? 0 : 100
		);
	}
	function leave(event: Event) {
		const next = (event as MouseEvent | FocusEvent).relatedTarget;
		if (!active || !(next instanceof Node) || !active.contains(next)) hide();
	}
	function scroll(event: Event) {
		// Revealing evidence inside Description does not move a form chip's anchor.
		if (
			event.target instanceof HTMLTextAreaElement &&
			event.target.id === 'description' &&
			active?.closest('.event-details')
		)
			return;
		hide();
	}

	function key(event: KeyboardEvent) {
		if (event.key === 'Escape') hide();
	}
	root.addEventListener('pointerover', show);
	root.addEventListener('focusin', show);
	root.addEventListener('pointerout', leave);
	root.addEventListener('focusout', leave);
	root.addEventListener('click', hide);
	root.addEventListener('keydown', key);
	window.addEventListener('scroll', scroll, true);
	window.addEventListener('resize', hide);
	return {
		destroy() {
			hide();
			root.removeEventListener('pointerover', show);
			root.removeEventListener('focusin', show);
			root.removeEventListener('pointerout', leave);
			root.removeEventListener('focusout', leave);
			root.removeEventListener('click', hide);
			root.removeEventListener('keydown', key);
			window.removeEventListener('scroll', scroll, true);
			window.removeEventListener('resize', hide);
		}
	};
}
