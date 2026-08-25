import type { ExplanationDto } from "@dto/ReviewDto";
import { BookIcon } from "@primer/octicons-react";
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./DiffExplanationAnnotation.module.css";
import { ExplanationBalloon } from "./ExplanationBalloon";

/**
 * How explanations sit on the diff. `chips` gives each line's explanations
 * a book chip pinned to the right edge that folds the cards away; `margin`
 * keeps the cards always open with no chip. Both take no diff rows: the
 * anchor is a zero-height element, so the code below never moves.
 */
export type ExplanationsMode = "chips" | "margin";

export interface DiffExplanationAnnotationProps {
	explanations: readonly ExplanationDto[];
	mode: ExplanationsMode;
}

/**
 * One line's explanations: a chip over the anchored line at the right edge
 * of the visible code area, and the open cards floated NEXT to the diff
 * rather than inside it. The cards must leave the renderer's DOM entirely
 * (a portal, fixed-position): every file block is its own scroller, so a
 * card kept inline is clipped at the block's edge — a one-line file cannot
 * fit a card on any side, and no z-index crosses a scroller's clip.
 *
 * The positioning effect lives here, not in a child: layout effects run
 * bottom-up, so a child component's effect would fire before this
 * component's anchor ref is attached and see it null forever.
 */
export function DiffExplanationAnnotation({
	explanations,
	mode,
}: DiffExplanationAnnotationProps) {
	const [open, setOpen] = useState(true);
	const anchorRef = useRef<HTMLDivElement>(null);
	const stackRef = useRef<HTMLDivElement>(null);
	const showCards = mode === "margin" || open;

	useLayoutEffect(() => {
		const stack = stackRef.current;
		const anchor = anchorRef.current;
		if (!showCards || stack === null || anchor === null) {
			return;
		}
		const viewport = scrollableAncestor(anchor);

		// re-derived from the live anchor rect on every scroll (capture phase,
		// so the diff's own scroller counts), on resize, and whenever the
		// cards change size; hidden once the anchor leaves the diff viewport,
		// since a fixed element would otherwise float over the chrome
		const update = () => {
			const anchorRect = anchor.getBoundingClientRect();
			const bounds = viewport?.getBoundingClientRect();
			if (
				bounds !== undefined &&
				(anchorRect.top < bounds.top || anchorRect.top > bounds.bottom)
			) {
				stack.style.visibility = "hidden";
				return;
			}
			stack.style.visibility = "visible";
			const height = stack.offsetHeight;
			const limit = bounds?.bottom ?? window.innerHeight;
			const roof = bounds?.top ?? 0;
			// the anchor sits at the bottom edge of the anchored line: below
			// means just under that line, above means just over it, clamped to
			// the diff viewport so a tall stack never vanishes off-screen
			const below = anchorRect.top + GAP_PX;
			const above = anchorRect.top - LINE_HEIGHT_PX - GAP_PX - height;
			const top =
				below + height <= limit
					? below
					: Math.max(roof, Math.min(above, limit - height));
			stack.style.top = `${top}px`;
			stack.style.right = `${Math.max(0, window.innerWidth - (bounds?.right ?? window.innerWidth)) + EDGE_PX}px`;
		};

		update();
		// the anchor's first rect can be measured before the renderer has laid
		// the rows out; the intersection observer re-fires once it settles
		const intersection =
			typeof IntersectionObserver === "undefined"
				? null
				: new IntersectionObserver(update);
		intersection?.observe(anchor);
		const resize =
			typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
		resize?.observe(stack);
		window.addEventListener("scroll", update, { capture: true, passive: true });
		window.addEventListener("resize", update);
		return () => {
			intersection?.disconnect();
			resize?.disconnect();
			window.removeEventListener("scroll", update, { capture: true });
			window.removeEventListener("resize", update);
		};
	}, [showCards]);

	if (explanations.length === 0) {
		return null;
	}

	return (
		<div className={styles.anchor} ref={anchorRef}>
			{mode === "chips" && (
				<button
					type="button"
					className={styles.chip}
					data-explanation-chip="true"
					aria-expanded={open}
					aria-label={
						open ? "Fold change explanation" : "Unfold change explanation"
					}
					onClick={() => setOpen((current) => !current)}
				>
					<BookIcon size={14} />
					{explanations.length > 1 && (
						<span className={styles.count}>{explanations.length}</span>
					)}
				</button>
			)}
			{showCards &&
				createPortal(
					<div className={styles.floating} ref={stackRef}>
						{explanations.map((explanation) => (
							<ExplanationBalloon
								key={explanation.id}
								explanation={explanation}
							/>
						))}
					</div>,
					document.body,
				)}
		</div>
	);
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

/** Pierre's --diffs-line-height default; the anchor line the chip sits on */
const LINE_HEIGHT_PX = 20;
const GAP_PX = 4;
const EDGE_PX = 24;
