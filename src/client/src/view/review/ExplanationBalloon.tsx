import type { ExplanationDto } from "@dto/ReviewDto";
import { BookIcon } from "@primer/octicons-react";
import { Fragment } from "react";
import styles from "./ExplanationBalloon.module.css";
import { useHighlightedExplanations } from "./highlightedExplanations";
import { TopicChip } from "./TopicChip";

/**
 * One change explanation on the diff: the author's account of what a change
 * does and why, read next to the code it describes. Deliberately not a
 * comment and styled not to read as one — no card, no actions, no tier —
 * because nothing here is feedback and nothing here is actionable.
 */
export function ExplanationBalloon({
	explanation,
	topicColor,
}: {
	explanation: ExplanationDto;
	/** the topic's palette slot (topicColors.ts); same label, same color */
	topicColor?: number;
}) {
	const highlighted = useHighlightedExplanations().has(explanation.id);
	return (
		<aside
			className={styles.balloon}
			data-explanation-id={explanation.id}
			data-highlighted={highlighted || undefined}
			aria-label="Change explanation"
		>
			<div className={styles.header}>
				<span className={styles.icon}>
					<BookIcon size={14} />
				</span>
				{explanation.topic !== undefined && (
					<TopicChip label={explanation.topic} color={topicColor} />
				)}
			</div>
			{explanation.says.map((sentence, index) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: says never reorders, and a repeated sentence would collide as its own key
				<p key={index} className={styles.sentence}>
					<BacktickText text={sentence} />
				</p>
			))}
			{explanation.placement.kind === "clamped" && (
				<p className={styles.clampNote}>
					Written about {lineRange(explanation)}, which this diff does not show;
					pinned to the nearest line.
				</p>
			)}
		</aside>
	);
}

function lineRange(explanation: ExplanationDto): string {
	return explanation.startLine === explanation.endLine
		? `line ${explanation.startLine}`
		: `lines ${explanation.startLine}–${explanation.endLine}`;
}

/**
 * `says` sentences are plain prose that may carry inline code in backticks;
 * that is the whole grammar, so a split beats a markdown renderer here.
 * Shared with the sidebar, which renders the same sentences.
 */
export function BacktickText({ text }: { text: string }) {
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
