import styles from "./Stepper.module.css";

export interface StepperProps {
	total: number;
	/** 0-based, so step 0 of 9 reads as "step 1 of 9" */
	current: number;
}

/**
 * How far through the reading order the reader is (F5's step progress).
 *
 * One segment per step rather than a bar or a ring: the walkthrough has a known,
 * countable number of steps, and seeing that there are four left is worth more
 * than seeing "67%". The segments are decoration for a screen reader — the
 * sentence beside them says the same thing in words.
 */
export function Stepper({ total, current }: StepperProps) {
	return (
		<div className={styles.stepper}>
			<ol className={styles.segments} aria-hidden="true">
				{Array.from({ length: total }, (_unused, index) => (
					<li
						className={styles.segment}
						data-state={segmentState(index, current)}
						// biome-ignore lint/suspicious/noArrayIndexKey: a segment IS its position; there is no content to key by and the list never reorders
						key={index}
					/>
				))}
			</ol>
			{/* one text node, so the sentence reads as one to a screen reader and
			    to anyone querying for it */}
			<p className={styles.position}>{`Step ${current + 1} of ${total}`}</p>
		</div>
	);
}

function segmentState(index: number, current: number): string {
	if (index < current) {
		return "read";
	}
	return index === current ? "current" : "unread";
}
