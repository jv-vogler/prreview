import type { ExplanationDto } from "@dto/ReviewDto";
import { BookIcon } from "@primer/octicons-react";
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./DiffExplanationAnnotation.module.css";
import { ExplanationBalloon } from "./ExplanationBalloon";
import { useExplanationCardLayout } from "./explanationCardLayout";

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
	/** each topic label's palette slot (topicColors.ts) */
	topicColors: ReadonlyMap<string, number>;
}

/**
 * One line's explanations: a chip over the anchored line at the right edge
 * of the visible code area, and the open cards floated NEXT to the diff
 * rather than inside it. The cards must leave the renderer's DOM entirely
 * (a portal, fixed-position): every file block is its own scroller, so a
 * card kept inline is clipped at the block's edge — a one-line file cannot
 * fit a card on any side, and no z-index crosses a scroller's clip.
 *
 * Positioning belongs to the shared card layout (explanationCardLayout.ts):
 * stacks near each other have to know about one another to not overlap, so
 * no single annotation can place its own. The registration effect lives
 * here, not in a child: layout effects run bottom-up, so a child's effect
 * would fire before this component's anchor ref is attached.
 */
export function DiffExplanationAnnotation({
	explanations,
	mode,
	topicColors,
}: DiffExplanationAnnotationProps) {
	const [open, setOpen] = useState(true);
	const anchorRef = useRef<HTMLDivElement>(null);
	const stackRef = useRef<HTMLDivElement>(null);
	const layout = useExplanationCardLayout();
	const showCards = mode === "margin" || open;
	const stackId = explanations[0]?.id;

	useLayoutEffect(() => {
		const stack = stackRef.current;
		const anchor = anchorRef.current;
		if (
			!showCards ||
			layout === null ||
			stackId === undefined ||
			stack === null ||
			anchor === null
		) {
			return;
		}
		return layout.register(stackId, anchor, stack);
	}, [showCards, layout, stackId]);

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
								topicColor={
									explanation.topic === undefined
										? undefined
										: topicColors.get(explanation.topic)
								}
							/>
						))}
					</div>,
					document.body,
				)}
		</div>
	);
}
