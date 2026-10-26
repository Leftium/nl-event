import { styledEvidenceSegments, type EvidenceRange } from './evidenceHighlight';

/** Presentation only: the parent retains the textarea value and native event handlers. */
export function descriptionEditor(
	shell: HTMLElement,
	initial: {
		value: string;
		fullscreen: boolean;
		wrap: boolean;
		ranges: readonly EvidenceRange[];
		selectedRanges?: readonly EvidenceRange[];
		unselectedRanges?: readonly EvidenceRange[];
		reveal?: object;
		hoverEvidence?: (range?: EvidenceRange) => void;
		close: () => void;
	}
) {
	const textarea = shell.querySelector('textarea')!;
	let options = initial;
	let frame = 0;
	let pendingReveal = false;
	let initialized = false;
	let unlock: (() => void) | undefined;
	let lastWidth = -1;
	let lastFill = false;
	const viewport = window.visualViewport;
	const mirror = document.createElement('div');
	const content = document.createElement('div');
	mirror.className = 'description-evidence';
	mirror.setAttribute('aria-hidden', 'true');
	mirror.style.cssText =
		'position:absolute;max-width:100%;overflow:hidden;pointer-events:none;z-index:0;';
	content.style.cssText = 'color:transparent;box-sizing:border-box;';
	mirror.append(content);
	textarea.before(mirror);

	function paintEvidence() {
		let offset = 0;
		content.replaceChildren(
			...styledEvidenceSegments(options.value, [
				{ kind: 'hovered', ranges: options.ranges ?? [] },
				{ kind: 'selected', ranges: options.selectedRanges ?? [] },
				{ kind: 'unselected', ranges: options.unselectedRanges ?? [] }
			]).map((segment) => {
				const start = offset;
				offset += segment.text.length;
				if (!segment.kind && !segment.hovered) return document.createTextNode(segment.text);
				const mark = document.createElement('mark');
				mark.textContent = segment.text;
				mark.dataset.start = String(start);
				mark.dataset.evidence = segment.kind ?? 'source';
				mark.dataset.hovered = String(segment.hovered);
				mark.style.cssText =
					'color:transparent;border:0;padding:0;margin:0;font:inherit;border-radius:2px;';
				mark.style.background =
					segment.kind === 'selected'
						? 'var(--evidence-selected-bg)'
						: segment.kind === 'unselected'
							? 'var(--evidence-unselected-bg)'
							: 'transparent';
				mark.style.boxShadow = 'none';
				mark.style.outline = segment.hovered ? '2px dashed var(--evidence-preview-color)' : 'none';
				mark.style.outlineOffset = '1px';
				mark.style.setProperty('box-decoration-break', 'clone');
				mark.style.setProperty('-webkit-box-decoration-break', 'clone');
				return mark;
			})
		);
		// A final empty line must occupy the same line box as in the textarea.
		content.append(document.createTextNode('\u200b'));
	}

	function leaveText() {
		options.hoverEvidence?.();
	}

	function hoverText(event: PointerEvent) {
		// Leave native dragging and touch selection entirely to the textarea.
		if (event.buttons || event.pointerType === 'touch') {
			leaveText();
			return;
		}
		const contains = (rect: DOMRect) =>
			event.clientX >= rect.left &&
			event.clientX < rect.right &&
			event.clientY >= rect.top &&
			event.clientY < rect.bottom;
		if (!contains(mirror.getBoundingClientRect())) {
			leaveText();
			return;
		}
		for (const mark of content.querySelectorAll<HTMLElement>('mark')) {
			if (![...mark.getClientRects()].some(contains)) continue;
			const text = mark.firstChild;
			if (!(text instanceof Text)) continue;
			// Locate the actual UTF-16 offset under the pointer. Mark boundaries can
			// change as previews overlap; using a character avoids expanding the hit area.
			const probe = document.createRange();
			let start = 0;
			let end = text.length;
			while (end - start > 1) {
				const middle = Math.floor((start + end) / 2);
				probe.setStart(text, start);
				probe.setEnd(text, middle);
				if ([...probe.getClientRects()].some(contains)) end = middle;
				else start = middle;
			}
			const offset = Number(mark.dataset.start) + start;
			options.hoverEvidence?.({ start: offset, end: offset + 1 });
			return;
		}
		leaveText();
	}
	textarea.addEventListener('pointermove', hoverText);
	textarea.addEventListener('pointerleave', leaveText);
	textarea.addEventListener('pointerdown', leaveText);
	textarea.addEventListener('input', leaveText);
	textarea.addEventListener('scroll', leaveText, { passive: true });

	function revealEvidence() {
		if (!pendingReveal) return;
		pendingReveal = false;
		const box = mirror.getBoundingClientRect();
		const gutter = Math.min(12, box.width / 4, box.height / 4);
		const left = box.left + gutter;
		const right = box.right - gutter;
		const top = box.top + gutter;
		const bottom = box.bottom - gutter;
		const rects = [...content.querySelectorAll('mark[data-hovered="true"]')].flatMap((mark) => [
			...mark.getClientRects()
		]);
		const distance = (rect: DOMRect) =>
			Math.max(0, top - rect.top, rect.bottom - bottom) +
			Math.max(0, left - rect.left, Math.min(rect.right, rect.left + right - left) - right);
		// Prefer the nearest fragment when a chip has discontinuous or repeated evidence.
		const rect = rects.sort((a, b) => distance(a) - distance(b))[0];
		if (!rect) return;
		const dx =
			rect.left < left
				? rect.left - left
				: Math.min(rect.right, rect.left + right - left) > right
					? Math.min(rect.right, rect.left + right - left) - right
					: 0;
		const dy = rect.top < top ? rect.top - top : rect.bottom > bottom ? rect.bottom - bottom : 0;
		textarea.scrollTop += dy;
		textarea.scrollLeft += dx;
		content.style.transform = `translate(${-textarea.scrollLeft}px, ${-textarea.scrollTop}px)`;
	}

	function syncEvidence() {
		const style = getComputedStyle(textarea);
		for (const name of [
			'font-family',
			'font-size',
			'font-weight',
			'font-style',
			'font-variant',
			'line-height',
			'letter-spacing',
			'word-spacing',
			'text-align',
			'text-indent',
			'text-transform',
			'tab-size',
			'direction',
			'padding-top',
			'padding-right',
			'padding-bottom',
			'padding-left'
		]) {
			content.style.setProperty(name, style.getPropertyValue(name));
		}
		content.style.whiteSpace = options.wrap ? 'pre-wrap' : 'pre';
		content.style.overflowWrap = options.wrap ? 'break-word' : 'normal';
		content.style.wordBreak = style.wordBreak;
		mirror.style.left = `${textarea.offsetLeft + textarea.clientLeft}px`;
		mirror.style.top = `${textarea.offsetTop + textarea.clientTop}px`;
		mirror.style.width = `${textarea.clientWidth}px`;
		mirror.style.height = `${textarea.clientHeight}px`;
		content.style.width = `${textarea.clientWidth}px`;
		content.style.transform = `translate(${-textarea.scrollLeft}px, ${-textarea.scrollTop}px)`;
		revealEvidence();
	}
	const evidenceObserver = new ResizeObserver(syncEvidence);
	evidenceObserver.observe(textarea);
	textarea.addEventListener('scroll', syncEvidence, { passive: true });

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
				syncEvidence();
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
				syncEvidence();
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
			syncEvidence();
		});
	}

	function pageScroll() {
		if (!options.fullscreen && fillsPane()) measure();
	}

	function update(next: typeof initial) {
		const layoutChanged =
			!initialized ||
			next.value !== options.value ||
			next.fullscreen !== options.fullscreen ||
			next.wrap !== options.wrap;
		initialized = true;
		pendingReveal =
			!!next.reveal &&
			(next.ranges?.length ?? 0) > 0 &&
			(pendingReveal || next.reveal !== options.reveal);
		options = next;
		paintEvidence();
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
			// A later fullscreen entry may happen after the viewport has resized.
			for (const name of ['top', 'left', 'height', 'width']) {
				shell.style.removeProperty(`--editor-${name}`);
			}
		}
		// Hover must not resize the textarea between pointer-down and pointer-up.
		if (layoutChanged) measure();
		else syncEvidence();
	}

	function keydown(event: KeyboardEvent) {
		// Native modal dialogs own their Escape behavior and focus trap.
		if ((event.target as Element).closest('dialog[open]')) return;
		if (!options.fullscreen || event.isComposing || event.defaultPrevented) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			options.close();
		} else if (event.key === 'Tab') {
			const controls = [
				...shell.querySelectorAll<HTMLElement>(
					'button:not(:disabled), textarea:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], summary'
				)
			].filter((control) => control.getClientRects().length);
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
			evidenceObserver.disconnect();
			textarea.removeEventListener('scroll', syncEvidence);
			textarea.removeEventListener('pointermove', hoverText);
			textarea.removeEventListener('pointerleave', leaveText);
			textarea.removeEventListener('pointerdown', leaveText);
			textarea.removeEventListener('input', leaveText);
			textarea.removeEventListener('scroll', leaveText);
			mirror.remove();
			shell.removeEventListener('keydown', keydown);
			window.removeEventListener('resize', measure);
			window.removeEventListener('scroll', pageScroll);
			viewport?.removeEventListener('resize', measure);
			viewport?.removeEventListener('scroll', measure);
			unlock?.();
		}
	};
}
