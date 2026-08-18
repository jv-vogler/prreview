import { type RefObject, useEffect, useRef, useState } from "react";

/**
 * Folds and unfolds a file by easing its height, rather than cutting to it.
 *
 * ## Why this can work at all
 *
 * The renderer virtualizes, and its item heights come from its own layout model
 * rather than from the DOM — in a dev build it *asserts* that the two agree. So
 * the first instinct, animating the code region with CSS and letting the model
 * catch up, looks like it would desynchronize the scroll math, the sticky
 * headers, and the render window for the length of the animation.
 *
 * It does not, because `CodeView` resize-observes the container its items live
 * in. Any drift between the measured height and its own `stickyHeight` makes it
 * re-reconcile the rendered items, reposition the sticky headers, and anchor the
 * scroll (`CodeView.handleResize`). An animation is just a lot of small drifts,
 * so the model follows the DOM frame by frame: the window refills as content
 * slides up, and the reader's scroll position is held for them. The mechanism
 * this needs was already there, deliberately.
 *
 * ## How it works
 *
 * The renderer is told to collapse a file only at the *end* of a fold and at the
 * *start* of an unfold, because collapsing removes the code from the DOM
 * entirely and there is nothing to ease once it is gone. In between, the height
 * itself is animated, under an `overflow: hidden` the injected shadow-root
 * stylesheet applies while a fold is in flight (`pierreChromeCss.ts`).
 * `:host()` and custom properties are the two things that cross a shadow
 * boundary, and they are all this uses: nothing patches the renderer.
 *
 * The hook takes the fold state the session asks for and returns the one the
 * renderer should draw, which lags it by one animation. Every path that folds a
 * file goes through this — the chevron, the header, and ticking "Viewed" — so
 * none of them has to know an animation exists.
 */

const FOLD_DURATION_MS = 180;
/** Primer's `--motion-easing-move`, which is not readable from script */
const FOLD_EASING = "cubic-bezier(0.65, 0, 0.35, 1)";
/**
 * How long to wait for the renderer to put the code back before giving up and
 * showing it. Highlighting is asynchronous, but the height is not: the file's
 * rows are laid out from the layout model as soon as the node exists, so this
 * resolves within a frame or two and the cap is only there so a hook can never
 * leave a file clamped shut.
 */
const MOUNT_WAIT_FRAMES = 30;

const FOLDING_ATTRIBUTE = "data-prr-folding";
const HEIGHT_PROPERTY = "--prr-fold-height";

export function useAnimatedCollapse(
	requested: ReadonlySet<string>,
	containerRef: RefObject<HTMLElement | null>,
): ReadonlySet<string> {
	const renderedRef = useRef<ReadonlySet<string>>(new Set(requested));
	const [drawn, setDrawn] = useState<ReadonlySet<string>>(renderedRef.current);
	const runningRef = useRef(new Map<string, FoldRun>());

	useEffect(() => {
		const running = runningRef.current;

		/*
		 * A new set every time, never a mutation of the old one. What this hook
		 * returns is a memo dependency of the renderer's item list, and a set
		 * whose identity never changes would leave the fold computed and undrawn
		 * — the same class of bug as a `version` that does not move.
		 */
		const commit = (fileId: string, collapsed: boolean) => {
			const next = new Set(renderedRef.current);
			if (collapsed) {
				next.add(fileId);
			} else {
				next.delete(fileId);
			}
			renderedRef.current = next;
			setDrawn(next);
		};

		const start = (fileId: string, collapsed: boolean) => {
			running.get(fileId)?.cancel();
			const host = findHost(containerRef.current, fileId);
			if (host === null || prefersReducedMotion()) {
				running.delete(fileId);
				commit(fileId, collapsed);
				return;
			}
			running.set(
				fileId,
				collapsed
					? foldOut(host, () => {
							running.delete(fileId);
							commit(fileId, true);
						})
					: foldIn(
							host,
							() => commit(fileId, false),
							() => running.delete(fileId),
						),
			);
		};

		for (const fileId of requested) {
			if (!renderedRef.current.has(fileId) && !running.has(fileId)) {
				start(fileId, true);
			}
		}
		for (const fileId of [...renderedRef.current]) {
			if (!requested.has(fileId) && !running.has(fileId)) {
				start(fileId, false);
			}
		}
		// a request that reversed mid-animation: the running fold is now the
		// wrong one, so it is replaced rather than allowed to finish
		for (const [fileId, run] of running) {
			if (run.collapsing !== requested.has(fileId)) {
				start(fileId, requested.has(fileId));
			}
		}
	}, [requested, containerRef]);

	// a fold left half-played would leave a file clamped shut forever
	useEffect(() => {
		const running = runningRef.current;
		return () => {
			for (const run of running.values()) {
				run.cancel();
			}
			running.clear();
		};
	}, []);

	return drawn;
}

interface FoldRun {
	collapsing: boolean;
	cancel(): void;
}

/** open → shut: ease the code away, then let the renderer drop it */
function foldOut(host: HTMLElement, done: () => void): FoldRun {
	const code = codeElementOf(host);
	if (code === null) {
		done();
		return { collapsing: true, cancel: () => {} };
	}

	// the attribute alone, with no clamp: the code keeps its own height until the
	// animation takes it over, it just stops overflowing while it shrinks
	host.setAttribute(FOLDING_ATTRIBUTE, "");
	const play = playHeight(code, code.getBoundingClientRect().height, 0, () => {
		// the code is gone with the commit, so releasing after it can never
		// show a frame of the file at full height on its way out
		done();
		release(host, play);
	});

	return {
		collapsing: true,
		cancel: () => release(host, play),
	};
}

/** shut → open: put the code back already clamped, then ease it out */
function foldIn(
	host: HTMLElement,
	expand: () => void,
	done: () => void,
): FoldRun {
	/*
	 * Clamped by CSS *before* the renderer is told to draw the code, because the
	 * animation cannot start until the element exists and the element must not
	 * be visible at full height for even the frame in between. The keyframes
	 * take over once it is there — an animation outranks an ordinary
	 * declaration, so the clamp simply stops mattering.
	 */
	clamp(host, 0);
	expand();

	const timers = new Timers();
	let play: Animation | undefined;
	timers.untilMounted(host, (code) => {
		// scrollHeight, not the box: the box is the clamp, and what is wanted is
		// the height the code would take if it were not clamped
		play = playHeight(code, 0, code.scrollHeight, () => {
			release(host, play);
			done();
		});
	});

	return {
		collapsing: false,
		cancel: () => {
			timers.clear();
			release(host, play);
		},
	};
}

/**
 * The height animation itself, driven by the Web Animations API rather than a
 * CSS transition.
 *
 * A transition needs its start value to be painted before its end value is set,
 * which means a forced reflow or a frame of hope, and a missed one degrades to
 * an instant cut that still *looks* like a working fold from the code's point of
 * view. Keyframes carry both ends explicitly, so there is nothing to miss, and
 * `finished` says exactly when to hand back rather than a timer that has to be
 * kept in step with a stylesheet.
 */
function playHeight(
	code: HTMLElement,
	from: number,
	to: number,
	done: () => void,
): Animation {
	const play = code.animate(
		[{ maxHeight: `${from}px` }, { maxHeight: `${to}px` }],
		{ duration: FOLD_DURATION_MS, easing: FOLD_EASING, fill: "forwards" },
	);
	play.finished.then(done).catch(() => {
		// cancelled by a fold that reversed under it; the canceller cleans up
	});
	return play;
}

function clamp(host: HTMLElement, height: number): void {
	host.style.setProperty(HEIGHT_PROPERTY, `${height}px`);
	host.setAttribute(FOLDING_ATTRIBUTE, "");
}

function release(host: HTMLElement, play?: Animation): void {
	play?.cancel();
	host.removeAttribute(FOLDING_ATTRIBUTE);
	host.style.removeProperty(HEIGHT_PROPERTY);
}

/**
 * The renderer's element for a file: the nearest ancestor of that file's fold
 * chevron that owns a shadow root.
 *
 * The chevron is the one light-DOM node that names a file, and the header it
 * sits in survives a collapse — only the code is removed — so this resolves in
 * both directions. Deliberately found by structure rather than by tag: the
 * renderer builds a plain `div` per item inside a `CodeView` and a
 * `diffs-container` for a standalone file, and which one it is is none of our
 * business. What we need is whichever element the header's stylesheet is
 * scoped to.
 */
function findHost(
	container: HTMLElement | null,
	fileId: string,
): HTMLElement | null {
	const chevron = container?.querySelector(
		`[data-file-fold="${CSS.escape(fileId)}"]`,
	);
	for (
		let node = chevron?.parentElement ?? null;
		node !== null;
		node = node.parentElement
	) {
		if (node.shadowRoot !== null) {
			return node;
		}
	}
	return null;
}

/** the code region, which exists only while the file is drawn open */
function codeElementOf(host: HTMLElement): HTMLElement | null {
	const code = host.shadowRoot?.querySelector("[data-diff]");
	return code instanceof HTMLElement ? code : null;
}

function prefersReducedMotion(): boolean {
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** the wait for the renderer to put a file's code back, cancellable */
class Timers {
	private frameId: number | undefined;

	/** waits for the renderer to lay the code out, then hands it over */
	untilMounted(host: HTMLElement, run: (code: HTMLElement) => void): void {
		let framesLeft = MOUNT_WAIT_FRAMES;
		const look = () => {
			const code = codeElementOf(host);
			if (code !== null && code.scrollHeight > 0) {
				run(code);
				return;
			}
			framesLeft -= 1;
			if (framesLeft <= 0) {
				// show a file we cannot measure rather than leave it clamped shut
				release(host);
				return;
			}
			this.frameId = requestAnimationFrame(look);
		};
		this.frameId = requestAnimationFrame(look);
	}

	clear(): void {
		if (this.frameId !== undefined) {
			cancelAnimationFrame(this.frameId);
		}
	}
}
