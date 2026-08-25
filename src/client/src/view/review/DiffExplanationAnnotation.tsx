import type { ExplanationDto } from "@dto/ReviewDto";
import { BookIcon } from "@primer/octicons-react";
import { useState } from "react";
import styles from "./DiffExplanationAnnotation.module.css";
import { ExplanationBalloon } from "./ExplanationBalloon";

/**
 * How explanations sit on the diff. `chips` folds each line's explanations
 * behind a small book chip pinned to the right edge; `margin` keeps the
 * cards always open in the same spot. Both take no diff rows: the anchor
 * is a zero-height element, so the code below never moves.
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
 * height: the chip floats over the anchor line and an open card floats
 * over the code below it.
 */
export function DiffExplanationAnnotation({
	explanations,
	mode,
}: DiffExplanationAnnotationProps) {
	const [open, setOpen] = useState(false);
	if (explanations.length === 0) {
		return null;
	}
	const showCards = mode === "margin" || open;

	return (
		<div className={styles.anchor}>
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
				<div className={styles.stack} data-mode={mode}>
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
