import type { ExplanationDto } from "@dto/ReviewDto";
import { BookIcon } from "@primer/octicons-react";
import { useLayoutEffect, useRef, useState } from "react";
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
 * One line's explanations, pinned to the right-hand side of the visible
 * code area (the annotation wrapper is horizontally sticky, so "right edge"
 * holds under horizontal scroll). Unlike comments, this contributes no
 * height: the chip floats over the anchor line and the open cards float
 * over the code around it, open by default and foldable per chip.
 */
export function DiffExplanationAnnotation({
	explanations,
	mode,
}: DiffExplanationAnnotationProps) {
	const [open, setOpen] = useState(true);
	const showCards = mode === "margin" || open;
	const direction = useStackDirection(showCards, explanations);
	if (explanations.length === 0) {
		return null;
	}

	return (
		<div className={styles.anchor} ref={direction.anchorRef}>
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
			{showCards && (
				<div
					className={styles.stack}
					ref={direction.stackRef}
					data-mode={mode}
					data-direction={direction.value}
				>
					{explanations.map((explanation) => (
						<ExplanationBalloon
							key={explanation.id}
							explanation={explanation}
						/>
					))}
				</div>
			)}
		</div>
	);
}

/**
 * Which way the open cards hang. The card floats inside the file's own
 * code block, and that block is a scroller: anything past its bottom edge
 * is clipped, not layered, and no z-index can cross a scroller's clip. So
 * an anchor near the end of a file opens its cards upward instead — down
 * whenever it fits, up only when down clips and up does not.
 */
function useStackDirection(
	showCards: boolean,
	explanations: readonly ExplanationDto[],
) {
	const anchorRef = useRef<HTMLDivElement>(null);
	const stackRef = useRef<HTMLDivElement>(null);
	const [value, setValue] = useState<"down" | "up">("down");

	useLayoutEffect(() => {
		if (!showCards) {
			return;
		}
		const anchor = anchorRef.current;
		const stack = stackRef.current;
		// the light-DOM chain out of the slot ends at the renderer's host
		// element, whose box is the file block the scroller clips to
		const fileBlock = anchor?.closest("diffs-container");
		if (
			anchor === null ||
			stack === null ||
			fileBlock === null ||
			fileBlock === undefined
		) {
			return;
		}
		const anchorTop = anchor.getBoundingClientRect().top;
		const blockRect = fileBlock.getBoundingClientRect();
		const height = stack.offsetHeight;
		const fitsDown = anchorTop + height <= blockRect.bottom;
		const fitsUp = anchorTop - LINE_HEIGHT_PX - height >= blockRect.top;
		setValue(fitsDown || !fitsUp ? "down" : "up");
	}, [showCards, explanations]);

	return { anchorRef, stackRef, value };
}

/** Pierre's --diffs-line-height default; the anchor line the chip sits on */
const LINE_HEIGHT_PX = 20;
