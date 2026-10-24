/** Presentation only: the parent retains the textarea value and native event handlers. */
export function descriptionEditor(
	shell: HTMLElement,
	initial: { value: string; fullscreen: boolean; wrap: boolean; close: () => void }
) {
	const textarea = shell.querySelector('textarea')!;
	let options = initial;
	let frame = 0;
	let unlock: (() => void) | undefined;
	let lastWidth = -1;
	let lastFill = false;
	const viewport = window.visualViewport;

	function fillsPane() {
		return getComputedStyle(shell).getPropertyValue('--editor-fill').trim() === '1';
	}

	function measure() {
		cancelAnimationFrame(frame);
		frame = requestAnimationFrame(() => {
			if (options.fullscreen) {
				shell.style.setProperty('--editor-top', `${viewport?.offsetTop ?? 0}px`);
				shell.style.setProperty('--editor-left', `${viewport?.offsetLeft ?? 0}px`);
				shell.style.setProperty('--editor-height', `${viewport?.height ?? innerHeight}px`);
				// Respect the layout viewport as well as a narrower visual viewport.
				shell.style.setProperty(
					'--editor-width',
					`${Math.min(viewport?.width ?? innerWidth, document.documentElement.clientWidth)}px`
				);
				textarea.style.height = '';
				return;
			}
			if (fillsPane()) {
				// Before sticking, the page heading occupies part of the viewport.
				// Grow into that space as it scrolls away, keeping the toolbar visible.
				const inset = parseFloat(getComputedStyle(shell).top) || 0;
				const top = Math.max(inset, shell.getBoundingClientRect().top);
				shell.style.setProperty(
					'--editor-pane-height',
					`${Math.max(0, innerHeight - top - inset)}px`
				);
				const scrollTop = textarea.scrollTop;
				textarea.style.height = '';
				textarea.scrollTop = scrollTop;
				return;
			}
			const style = getComputedStyle(textarea);
			const line = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5;
			const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
			const border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
			const scrollTop = textarea.scrollTop;
			textarea.style.height = '0px';
			textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight + border, line + padding + border), line * 6 + padding + border)}px`;
			textarea.scrollTop = scrollTop;
		});
	}

	function pageScroll() {
		if (!options.fullscreen && fillsPane()) measure();
	}

	function update(next: typeof initial) {
		options = next;
		if (options.fullscreen && !unlock) {
			const x = window.scrollX;
			const y = window.scrollY;
			const properties = ['position', 'top', 'left', 'width', 'overflow-x', 'overflow-y'] as const;
			const saved = properties.map((name) => [
				name,
				document.body.style.getPropertyValue(name),
				document.body.style.getPropertyPriority(name)
			]);
			const root = document.documentElement;
			const rootProperties = ['overflow-x', 'overflow-y', 'scrollbar-gutter'] as const;
			const savedRoot = rootProperties.map((name) => [
				name,
				root.style.getPropertyValue(name),
				root.style.getPropertyPriority(name)
			]);
			// Lock the root too: a stable gutter otherwise clips fixed fullscreen content.
			root.style.overflow = 'hidden';
			root.style.scrollbarGutter = 'auto';
			document.body.style.position = 'fixed';
			document.body.style.top = `${-y}px`;
			document.body.style.left = `${-x}px`;
			document.body.style.width = '100%';
			document.body.style.overflow = 'hidden';
			unlock = () => {
				for (const [name, value, priority] of saved) {
					if (value) document.body.style.setProperty(name, value, priority);
					else document.body.style.removeProperty(name);
				}
				for (const [name, value, priority] of savedRoot) {
					if (value) root.style.setProperty(name, value, priority);
					else root.style.removeProperty(name);
				}
				window.scrollTo(x, y);
			};
		} else if (!options.fullscreen && unlock) {
			unlock();
			unlock = undefined;
		}
		measure();
	}

	function keydown(event: KeyboardEvent) {
		if (!options.fullscreen || event.isComposing || event.defaultPrevented) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			options.close();
		} else if (event.key === 'Tab') {
			const controls = [
				...shell.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled)')
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
	}
	const observer = new ResizeObserver(() => {
		const fill = fillsPane();
		// Height-only transitions can change modes while the capped shell width stays the same.
		if (shell.clientWidth === lastWidth && fill === lastFill) return;
		lastWidth = shell.clientWidth;
		lastFill = fill;
		measure();
	});
	observer.observe(shell);
	shell.addEventListener('keydown', keydown);
	window.addEventListener('resize', measure);
	window.addEventListener('scroll', pageScroll, { passive: true });
	viewport?.addEventListener('resize', measure);
	viewport?.addEventListener('scroll', measure);
	// Font loading can change line metrics without changing the shell width.
	let disposed = false;
	void document.fonts.ready.then(() => {
		if (!disposed) measure();
	});
	update(initial);
	return {
		update,
		destroy() {
			disposed = true;
			cancelAnimationFrame(frame);
			observer.disconnect();
			shell.removeEventListener('keydown', keydown);
			window.removeEventListener('resize', measure);
			window.removeEventListener('scroll', pageScroll);
			viewport?.removeEventListener('resize', measure);
			viewport?.removeEventListener('scroll', measure);
			unlock?.();
		}
	};
}
