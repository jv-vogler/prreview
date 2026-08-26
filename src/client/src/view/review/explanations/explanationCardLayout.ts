import { createContext, useContext } from "react";

const GAP_PX = 4;

const STACK_GAP_PX = 8;

const EDGE_PX = 24;

const FLOOR_PX = 16;

export interface ExplanationCardLayout {
	register(id: string, anchor: HTMLElement, stack: HTMLElement): () => void;
}

interface Placement {
	stack: HTMLElement;
	top: number;
	anchorTop: number;
}

function sideOf(
	anchorTop: number,
	roof: number,
	limit: number,
): "above" | "below" | undefined {
	if (anchorTop < roof) {
		return "above";
	}
	return anchorTop > limit ? "below" : undefined;
}

function placeStack(
	entry: TrackedStack,
	roof: number,
	limit: number,
): Placement | null {
	const { anchor, stack } = entry;
	if (entry.block === undefined) {
		entry.block = anchor.closest("diffs-container");
	}
	const blockRect = entry.block?.getBoundingClientRect();
	const blockOnScreen =
		blockRect !== undefined && blockRect.width > 0 && blockRect.bottom > roof;
	const stuckTop = () =>
		blockRect === undefined
			? roof + GAP_PX
			: Math.min(roof + GAP_PX, blockRect.bottom - stack.offsetHeight);

	const anchorRect = anchor.getBoundingClientRect();
	if (anchorRect.width === 0) {
		return entry.lastSeen === "above" && blockOnScreen
			? { stack, top: stuckTop(), anchorTop: Number.NEGATIVE_INFINITY }
			: null;
	}

	const anchorTop = anchorRect.top;
	entry.lastSeen = sideOf(anchorTop, roof, limit);

	if (anchorTop > limit) {
		return null;
	}
	if (anchorTop < roof) {
		return blockOnScreen ? { stack, top: stuckTop(), anchorTop } : null;
	}
	return { stack, top: anchorTop + GAP_PX, anchorTop };
}

interface TrackedStack {
	anchor: HTMLElement;
	stack: HTMLElement;
	block?: Element | null;
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

	const mutations =
		typeof MutationObserver === "undefined"
			? null
			: new MutationObserver(schedule);
	const resizes =
		typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);

	const rewatchViewport = (viewport: Element | null) => {
		if (viewport === watchedViewport) {
			return;
		}
		mutations?.disconnect();
		if (watchedViewport !== null) {
			resizes?.unobserve(watchedViewport);
		}
		if (viewport !== null) {
			mutations?.observe(viewport, {
				childList: true,
				subtree: true,
				attributes: true,
				attributeFilter: ["style", "class"],
			});

			resizes?.observe(viewport);
		}
		watchedViewport = viewport;
	};

	const settle = (visible: Placement[], limit: number, right: string) => {
		visible.sort((a, b) => a.top - b.top || a.anchorTop - b.anchorTop);
		let floor = Number.NEGATIVE_INFINITY;
		for (const { stack, top } of visible) {
			const lowest = limit - FLOOR_PX - stack.offsetHeight;
			const settled = Math.min(Math.max(top, floor), lowest);
			stack.style.top = `${settled}px`;
			stack.style.right = right;
			stack.style.visibility = "visible";
			floor = settled + stack.offsetHeight + STACK_GAP_PX;
		}
	};

	const relayout = () => {
		const first = stacks.values().next();
		if (first.done) {
			return;
		}
		const viewport = scrollableAncestor(first.value.anchor);
		rewatchViewport(viewport);
		const bounds = viewport?.getBoundingClientRect();
		const roof = bounds?.top ?? 0;
		const limit = bounds?.bottom ?? window.innerHeight;
		const right = `${Math.max(0, window.innerWidth - (bounds?.right ?? window.innerWidth)) + EDGE_PX}px`;

		const visible: Placement[] = [];
		for (const entry of stacks.values()) {
			const placement = placeStack(entry, roof, limit);
			if (placement === null) {
				entry.stack.style.visibility = "hidden";
			} else {
				visible.push(placement);
			}
		}
		settle(visible, limit, right);
	};

	const listen = () => {
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
