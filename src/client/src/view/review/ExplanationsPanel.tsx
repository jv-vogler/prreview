import type { ExplanationDto } from "@dto/ReviewDto";
import { topicColorsFor } from "../../domain/review/topicColors";
import { type Topic, topicsFor } from "../../domain/review/topics";
import { BacktickText } from "./ExplanationBalloon";
import styles from "./ExplanationsPanel.module.css";
import { useHighlightedExplanations } from "./highlightedExplanations";
import { TopicChip } from "./TopicChip";

export interface ExplanationsPanelProps {
	explanations: readonly ExplanationDto[];
	/** entry clicked: scroll the diff there and light that balloon */
	onJumpTo(explanation: ExplanationDto): void;
	/** the topic chip toggles the highlight on every balloon it groups */
	onToggleTopic(topic: Topic): void;
}

/**
 * The pass retold as its explanations: the sidebar's second tab organizes
 * every card into a read-through summary of the PR. Topics first — one
 * chip, its shared color, one jump link per anchored change, which is how
 * an intent spanning several files stays one unit — then the standalone
 * explanations under their own paths. An explanation the diff cannot
 * anchor is listed too, marked instead of vanishing.
 */
export function ExplanationsPanel({
	explanations,
	onJumpTo,
	onToggleTopic,
}: ExplanationsPanelProps) {
	const highlighted = useHighlightedExplanations();
	const topics = topicsFor(explanations);
	const colors = topicColorsFor(explanations);
	const standalone = explanations.filter(
		(explanation) => explanation.topic === undefined,
	);
	if (explanations.length === 0) {
		return <p className={styles.empty}>No explanations.</p>;
	}
	return (
		<div className={styles.panel}>
			{topics.map((topic) => (
				<section key={topic.label} className={styles.topic}>
					<TopicChip
						label={topic.label}
						color={colors.get(topic.label)}
						pressed={topic.explanations.every((explanation) =>
							highlighted.has(explanation.id),
						)}
						onToggle={() => onToggleTopic(topic)}
					/>
					<ul className={styles.entries}>
						{topic.explanations.map((explanation) => (
							<Entry
								key={explanation.id}
								explanation={explanation}
								onJumpTo={onJumpTo}
							/>
						))}
					</ul>
				</section>
			))}
			{standalone.length > 0 && (
				<ul className={styles.entries}>
					{standalone.map((explanation) => (
						<Entry
							key={explanation.id}
							explanation={explanation}
							onJumpTo={onJumpTo}
						/>
					))}
				</ul>
			)}
		</div>
	);
}

function Entry({
	explanation,
	onJumpTo,
}: {
	explanation: ExplanationDto;
	onJumpTo(explanation: ExplanationDto): void;
}) {
	const place = `${explanation.path}:${explanation.startLine}`;
	return (
		<li className={styles.entry} data-explanation-entry={explanation.id}>
			{explanation.placement.kind === "unplaceable" ? (
				<p className={styles.unplaced}>
					{place}
					<span className={styles.unplacedNote}> · not in the diff</span>
				</p>
			) : (
				<button
					type="button"
					className={styles.jump}
					onClick={() => onJumpTo(explanation)}
				>
					{place}
				</button>
			)}
			<p className={styles.says}>
				<BacktickText text={explanation.says.join(" ")} />
			</p>
		</li>
	);
}
