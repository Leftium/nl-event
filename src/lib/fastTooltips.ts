export function fastTooltips(root: HTMLElement) {
	let active: HTMLElement | null = null;
	let tooltip: HTMLDivElement | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let described: HTMLElement | null = null;
	let hideTimer: ReturnType<typeof setTimeout> | undefined;
	function wheel(event: WheelEvent) {
		const node = event.currentTarget as HTMLDivElement;
		if (node.scrollHeight <= node.clientHeight) return;
		event.preventDefault();
		const unit =
			event.deltaMode === 1
				? parseFloat(getComputedStyle(node).lineHeight) || 16
				: event.deltaMode === 2
					? node.clientHeight
					: 1;
		node.scrollTop += event.deltaY * unit;
	}
	function hide() {
		clearTimeout(timer);
		clearTimeout(hideTimer);
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
	function position() {
		if (!active || !tooltip) return;
		const box = active.getBoundingClientRect();
		const viewport = window.visualViewport;
		let left = (viewport?.offsetLeft ?? 0) + 8;
		let right =
			Math.min(
				document.documentElement.clientWidth,
				(viewport?.offsetLeft ?? 0) + (viewport?.width ?? innerWidth)
			) - 8;
		const top = (viewport?.offsetTop ?? 0) + 8;
		const bottom = (viewport?.offsetTop ?? 0) + (viewport?.height ?? innerHeight) - 8;
		const pane = active.closest('.event-details');
		const editor = root.querySelector('.description-editor');
		if (pane && editor && active.matches('.suggestion')) {
			const formBox = pane.getBoundingClientRect();
			const editorBox = editor.getBoundingClientRect();
			// Measured side-by-side geometry also handles zoom and short layouts.
			if (formBox.right <= editorBox.left && editorBox.width > 0) {
				left = Math.max(left, formBox.left + 8);
				right = Math.min(right, formBox.right - 8);
			}
		}
		tooltip.style.maxWidth = `min(24rem, ${Math.max(1, right - left)}px)`;
		const above = Math.max(0, box.top - 6 - top);
		const below = Math.max(0, bottom - box.bottom - 6);
		tooltip.style.maxHeight = `${Math.max(1, Math.min(bottom - top, Math.max(above, below)))}px`;
		tooltip.style.overflowY = 'auto';
		const size = tooltip.getBoundingClientRect();
		tooltip.style.left = `${Math.max(left, Math.min(box.left, right - size.width))}px`;
		const preferredTop =
			box.bottom + size.height + 6 <= bottom ? box.bottom + 6 : box.top - size.height - 6;
		tooltip.style.top = `${Math.max(top, Math.min(preferredTop, bottom - size.height))}px`;
	}

	function show(event: Event) {
		if (event.target instanceof Node && tooltip?.contains(event.target)) return;
		clearTimeout(hideTimer);
		const target = (event.target as Element).closest<HTMLElement>('[data-tooltip]');
		if (target === active && event.type !== 'focusin') return;
		if (!target?.dataset.tooltip && event.type === 'pointerover') {
			// Allow crossing the small gap between a chip and its scrollable tooltip.
			if (active) hideTimer = setTimeout(hide, 150);
			return;
		}
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
				tooltip.addEventListener('pointerenter', () => clearTimeout(hideTimer));
				tooltip.addEventListener('pointerleave', leave);
				tooltip.addEventListener('wheel', wheel, { passive: false });
				// Keep dialog tooltips in the modal's top layer.
				(target.closest('dialog') ?? document.body).append(tooltip);
				described.setAttribute(
					'aria-describedby',
					[described.getAttribute('aria-describedby'), tooltip.id].filter(Boolean).join(' ')
				);
				position();
			},
			event.type === 'focusin' ? 0 : 100
		);
	}
	function leave(event: Event) {
		const next = (event as MouseEvent | FocusEvent).relatedTarget;
		if (next instanceof Node && (active?.contains(next) || tooltip?.contains(next))) return;
		if (event.type === 'pointerout' || event.type === 'pointerleave') {
			clearTimeout(hideTimer);
			hideTimer = setTimeout(hide, 150);
		} else hide();
	}
	function scroll(event: Event) {
		if (event.target instanceof Node && tooltip?.contains(event.target)) return;
		// Revealing evidence inside Description does not move a form chip's anchor.
		if (
			event.target instanceof HTMLTextAreaElement &&
			event.target.id === 'description' &&
			active?.closest('.event-details')
		)
			return;
		// Focus can scroll the page after a tooltip opens. Follow its anchor.
		if (active && document.activeElement === described) position();
		else hide();
	}

	function click(event: Event) {
		if (!(event.target instanceof Node) || !tooltip?.contains(event.target)) hide();
	}

	function key(event: KeyboardEvent) {
		if (event.key === 'Escape') hide();
		else if (
			tooltip &&
			document.activeElement === active &&
			!event.altKey &&
			!event.ctrlKey &&
			!event.metaKey &&
			!event.shiftKey &&
			tooltip.scrollHeight > tooltip.clientHeight
		) {
			const amount =
				event.key === 'PageDown'
					? tooltip.clientHeight
					: event.key === 'PageUp'
						? -tooltip.clientHeight
						: 0;
			if (amount) {
				event.preventDefault();
				tooltip.scrollTop += amount;
			}
		}
	}
	root.addEventListener('pointerover', show);
	root.addEventListener('focusin', show);
	root.addEventListener('pointerout', leave);
	root.addEventListener('focusout', leave);
	root.addEventListener('click', click);
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
			root.removeEventListener('click', click);
			root.removeEventListener('keydown', key);
			window.removeEventListener('scroll', scroll, true);
			window.removeEventListener('resize', hide);
		}
	};
}
