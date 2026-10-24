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
				const size = tooltip.getBoundingClientRect();
				tooltip.style.left = `${Math.max(8, Math.min(box.left, innerWidth - size.width - 8))}px`;
				tooltip.style.top = `${Math.max(8, box.bottom + size.height + 14 < innerHeight ? box.bottom + 6 : box.top - size.height - 6)}px`;
			},
			event.type === 'focusin' ? 0 : 100
		);
	}
	function leave(event: Event) {
		const next = (event as MouseEvent | FocusEvent).relatedTarget;
		if (!active || !(next instanceof Node) || !active.contains(next)) hide();
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
	window.addEventListener('scroll', hide, true);
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
			window.removeEventListener('scroll', hide, true);
			window.removeEventListener('resize', hide);
		}
	};
}
