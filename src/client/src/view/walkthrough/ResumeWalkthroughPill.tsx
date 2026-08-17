import { ChevronRightIcon, XIcon } from "@primer/octicons-react";
import type { WalkthroughStepDto } from "../../domain/walkthrough/resolveStepTarget";
import styles from "./ResumeWalkthroughPill.module.css";

export interface ResumeWalkthroughPillProps {
	/** 0-based index of the step the reader left */
	fromStep: number;
	total: number;
	step: WalkthroughStepDto | undefined;
	onResume(): void;
	onDismiss(): void;
}

/**
 * What is left behind when the reader steps out of the guided order to look at
 * something themselves (F5: "free to jump out to browsing and back").
 *
 * It keeps the place and names it, so coming back is one click rather than a
 * hunt — and it can be put away, because a reader who is done with the guided
 * order should not have to carry it for the rest of the session.
 */
export function ResumeWalkthroughPill({
	fromStep,
	total,
	step,
	onResume,
	onDismiss,
}: ResumeWalkthroughPillProps) {
	const position = `step ${fromStep + 1} of ${total}`;

	return (
		<div className={styles.pill}>
			<p className={styles.paused}>
				Walkthrough paused at {position}
				{step !== undefined && (
					<span className={styles.title}>{step.title}</span>
				)}
			</p>
			<button type="button" className={styles.resume} onClick={onResume}>
				Back to {position}
				<ChevronRightIcon size={16} />
			</button>
			<button
				type="button"
				className={styles.close}
				onClick={onDismiss}
				aria-label="Put the walkthrough away"
				title="Put the walkthrough away (w reopens it)"
			>
				<XIcon size={16} />
			</button>
		</div>
	);
}
