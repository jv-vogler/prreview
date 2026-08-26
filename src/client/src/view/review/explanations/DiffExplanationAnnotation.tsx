import type { ExplanationDto } from "@dto/ReviewDto";
import { BookIcon } from "@primer/octicons-react";
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./DiffExplanationAnnotation.module.css";
import { ExplanationBalloon } from "./ExplanationBalloon";
import { useExplanationCardLayout } from "./explanationCardLayout";

export type ExplanationsMode = "chips" | "margin";

export interface DiffExplanationAnnotationProps {
	explanations: readonly ExplanationDto[];
	mode: ExplanationsMode;
	topicColors: ReadonlyMap<string, number>;
}

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
