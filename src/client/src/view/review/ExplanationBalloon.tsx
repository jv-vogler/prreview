import type { ExplanationDto } from "@dto/ReviewDto";
import { BookIcon } from "@primer/octicons-react";
import { Fragment } from "react";
import styles from "./ExplanationBalloon.module.css";

/**
 * One change explanation on the diff: the author's account of what a change
 * does and why, read next to the code it describes. Deliberately not a
 * comment and styled not to read as one — no card, no actions, no tier —
 * because nothing here is feedback and nothing here is actionable.
 */
export function ExplanationBalloon({
	explanation,
}: {
	explanation: ExplanationDto;
}) {
	return (
		<aside
			className={styles.balloon}
			data-explanation-id={explanation.id}
			aria-label="Change explanation"
		>
			<div className={styles.header}>
				<span className={styles.icon}>
					<BookIcon size={14} />
				</span>
				{explanation.topic !== undefined && (
					<span className={styles.topic}>{explanation.topic}</span>
				)}
			</div>
			{explanation.says.map((sentence) => (
				<p key={sentence} className={styles.sentence}>
					<BacktickText text={sentence} />
				</p>
			))}
		</aside>
	);
}

/**
 * `says` sentences are plain prose that may carry inline code in backticks;
 * that is the whole grammar, so a split beats a markdown renderer here.
 */
function BacktickText({ text }: { text: string }) {
	const parts = text.split("`");
	return (
		<>
			{parts.map((part, index) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: position is a text fragment's only identity
				<Fragment key={index}>
					{index % 2 === 1 ? <code className={styles.code}>{part}</code> : part}
				</Fragment>
			))}
		</>
	);
}
