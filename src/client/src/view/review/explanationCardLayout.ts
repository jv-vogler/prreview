import { createContext, useContext } from "react";

/** gap between the anchored line's bottom edge and the first card under it */
const GAP_PX = 4;
/** gap kept between two stacks pushed apart so neither covers the other */
const STACK_GAP_PX = 8;
/** inset from the diff viewport's right edge */
const EDGE_PX = 24;

export interface ExplanationCardLayout {
	/** starts tracking one line's open card stack; returns its release */
	register(id: string, anchor: HTMLElement, stack: HTMLElement): () => void;
}

/**
 * One layout pass over every open card stack, instead of each stack placing
 * itself. A stack alone can only see its own anchor, which loses two ways:
 * stacks on nearby lines land on top of each other, and none of them notices
 * the diff reflowing under it — expanding a comment balloon moves every line
 * below without a single scroll event, stranding the cards mid-page.
 *
 * The manager re-derives every position together: on scroll and resize, when
 * a stack changes size, and on any DOM change inside the diff viewport (the
 * reflow case). Stacks lay out top to bottom pinned beside their anchors; a
 * stack that would overlap the one above it slides down below it instead.
 */
interface TrackedStack {
	anchor: HTMLElement;
	stack: HTMLElement;
	/** the anchored file block, looked up once the anchor is in a document */
	block?: Element | null;
	/** which side of the viewport the anchor was last measured on: the
	 * renderer drops a row's layout (and reshapes the block) once it scrolls
	 * far enough out, so this remembered side is the only trustworthy fact
	 * left about where the line went */
	lastSeen?: "above" | "below";
}

export function createExplanationCardLayout(): ExplanationCardLayout {
	const stacks = new Map<string, TrackedStack>();
	let frame: number | null = null;
	let watchedViewport: Element | null = null;

	const schedule = () => {
		if (frame === null) {
			frame = requestAnimationFrame(() => {
				frame = null;
				relayout();
			});
		}
	};

	// jsdom ships neither observer; the layout still works, it just only
	// re-derives on the explicit triggers
	const mutations =
		typeof MutationObserver === "undefined"
			? null
			: new MutationObserver(schedule);
	const resizes =
		typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);

	const relayout = () => {
		const first = stacks.values().next();
		if (first.done) {
			return;
		}
		const viewport = scrollableAncestor(first.value.anchor);
		if (viewport !== watchedViewport) {
			mutations?.disconnect();
			if (watchedViewport !== null) {
				resizes?.unobserve(watchedViewport);
			}
			if (viewport !== null) {
				// attributes as well: the renderer moves rows by rewriting style
				// transforms, so a childList-only observer sees the balloon land
				// but never the lines shifting under it
				mutations?.observe(viewport, {
					childList: true,
					subtree: true,
					attributes: true,
					attributeFilter: ["style", "class"],
				});
				// and the viewport's own size: chrome above it folding away
				// moves the whole diff without a single event inside it
				resizes?.observe(viewport);
			}
			watchedViewport = viewport;
		}
		const bounds = viewport?.getBoundingClientRect();
		const roof = bounds?.top ?? 0;
		const limit = bounds?.bottom ?? window.innerHeight;
		const right = `${Math.max(0, window.innerWidth - (bounds?.right ?? window.innerWidth)) + EDGE_PX}px`;
		const visible: { stack: HTMLElement; top: number; anchorTop: number }[] =
			[];
		for (const entry of stacks.values()) {
			const { anchor, stack } = entry;
			if (entry.block === undefined) {
				entry.block = anchor.closest("diffs-container");
			}
			const blockRect = entry.block?.getBoundingClientRect();
			const blockOnScreen =
				blockRect !== undefined &&
				blockRect.width > 0 &&
				blockRect.bottom > roof;
			const stuckTop = () =>
				blockRect === undefined
					? roof + GAP_PX
					: Math.min(roof + GAP_PX, blockRect.bottom - stack.offsetHeight);
			const anchorRect = anchor.getBoundingClientRect();
			if (anchorRect.width === 0) {
				// the renderer drops a far-out row's layout (and reshapes the
				// block), so a zero rect says nothing about where the line is.
				// The remembered side does: last seen above and its block still
				// on screen, the card stays stuck at the top; last seen below,
				// or never measured at all, there is nothing honest to show.
				if (entry.lastSeen === "above" && blockOnScreen) {
					visible.push({
						stack,
						top: stuckTop(),
						anchorTop: Number.NEGATIVE_INFINITY,
					});
				} else {
					stack.style.visibility = "hidden";
				}
				continue;
			}
			const anchorTop = anchorRect.top;
			entry.lastSeen =
				anchorTop < roof ? "above" : anchorTop > limit ? "below" : undefined;
			// below the viewport it just waits its turn; a fixed element would
			// otherwise float over the surrounding chrome
			if (anchorTop > limit) {
				stack.style.visibility = "hidden";
				continue;
			}
			let top = anchorTop + GAP_PX;
			if (anchorTop < roof) {
				// the line scrolled past, but its context is still on screen:
				// the card sticks at the viewport top while its file block
				// remains, and slides out under the block's own end
				if (!blockOnScreen) {
					stack.style.visibility = "hidden";
					continue;
				}
				top = stuckTop();
			}
			visible.push({ stack, top, anchorTop });
		}
		visible.sort((a, b) => a.top - b.top || a.anchorTop - b.anchorTop);
		let floor = Number.NEGATIVE_INFINITY;
		for (const { stack, top } of visible) {
			const settled = Math.max(top, floor);
			stack.style.top = `${settled}px`;
			stack.style.right = right;
			stack.style.visibility = "visible";
			floor = settled + stack.offsetHeight + STACK_GAP_PX;
		}
	};

	const listen = () => {
		// capture phase so the diff's own scroller counts, not just the window
		window.addEventListener("scroll", schedule, {
			capture: true,
			passive: true,
		});
		window.addEventListener("resize", schedule);
	};

	const unlisten = () => {
		window.removeEventListener("scroll", schedule, { capture: true });
		window.removeEventListener("resize", schedule);
		mutations?.disconnect();
		if (watchedViewport !== null) {
			resizes?.unobserve(watchedViewport);
		}
		watchedViewport = null;
		if (frame !== null) {
			cancelAnimationFrame(frame);
			frame = null;
		}
	};

	return {
		register(id, anchor, stack) {
			if (stacks.size === 0) {
				listen();
			}
			stacks.set(id, { anchor, stack });
			resizes?.observe(stack);
			// synchronous: the stack must be placed before the frame paints
			relayout();
			return () => {
				stacks.delete(id);
				resizes?.unobserve(stack);
				if (stacks.size === 0) {
					unlisten();
				} else {
					schedule();
				}
			};
		},
	};
}

/** the nearest ancestor that actually scrolls — the diff viewport */
function scrollableAncestor(element: Element): Element | null {
	let node = element.parentElement;
	while (node !== null) {
		const { overflowY } = getComputedStyle(node);
		if (overflowY === "auto" || overflowY === "scroll") {
			return node;
		}
		node = node.parentElement;
	}
	return null;
}

export const ExplanationCardLayoutContext =
	createContext<ExplanationCardLayout | null>(null);

export function useExplanationCardLayout(): ExplanationCardLayout | null {
	return useContext(ExplanationCardLayoutContext);
}
