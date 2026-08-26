import type { ExplanationDto } from "@dto/ReviewDto";
import { BookIcon } from "@primer/octicons-react";
import { Fragment } from "react";
import styles from "./ExplanationBalloon.module.css";
import { useHighlightedExplanations } from "./highlightedExplanations";
import { TopicChip } from "./TopicChip";

export function ExplanationBalloon({
	explanation,
	topicColor,
}: {
	explanation: ExplanationDto;
	topicColor?: number;
}) {
	const selection = useHighlightedExplanations();
	const highlighted = selection.has(explanation.id);

	const dimmed = selection.size > 0 && !highlighted;
	return (
		<aside
			className={styles.balloon}
			data-explanation-id={explanation.id}
			data-highlighted={highlighted || undefined}
			data-dimmed={dimmed || undefined}
			aria-label="Change explanation"
		>
			<div className={styles.header}>
				<span className={styles.icon}>
					<BookIcon size={14} />
				</span>
				{explanation.topic !== undefined && (
					<TopicChip label={explanation.topic} color={topicColor} wrap />
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
