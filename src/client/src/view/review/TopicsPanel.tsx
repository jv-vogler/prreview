import type { ExplanationDto } from "@dto/ReviewDto";
import { BookIcon } from "@primer/octicons-react";
import type { Topic } from "../../domain/review/topics";
import { BacktickText } from "./ExplanationBalloon";
import { useHighlightedTopic } from "./highlightedTopic";
import styles from "./TopicsPanel.module.css";

export interface TopicsPanelProps {
	topics: readonly Topic[];
	/** scroll the diff to this explanation and highlight its topic */
	onJump(explanation: ExplanationDto): void;
	/** highlight this topic's balloons, or clear when already highlighted */
	onToggleHighlight(label: string): void;
}

/**
 * The PR retold as its units of intent (the plan's topics view): one row
 * per shared `topic` label, the sentences its explanations carry, and a
 * link to each anchored change. Rendered inside the diff's scroll content,
 * above the first file — no tab, no sidebar, and no code excerpts: the
 * links lead to the real diff, which is the one unfoldable rendering.
 */
export function TopicsPanel({
	topics,
	onJump,
	onToggleHighlight,
}: TopicsPanelProps) {
	const highlighted = useHighlightedTopic();
	if (topics.length === 0) {
		return null;
	}
	return (
		<section className={styles.panel} aria-label="Topics">
			{topics.map((topic) => (
				<div
					key={topic.label}
					className={styles.topic}
					data-highlighted={highlighted === topic.label || undefined}
				>
					<button
						type="button"
						className={styles.label}
						aria-pressed={highlighted === topic.label}
						onClick={() => onToggleHighlight(topic.label)}
					>
						<BookIcon size={14} />
						{topic.label}
					</button>
					<div className={styles.entries}>
						{topic.explanations.map((explanation) => (
							<div key={explanation.id} className={styles.entry}>
								<button
									type="button"
									className={styles.jump}
									data-topic-jump={explanation.id}
									onClick={() => onJump(explanation)}
								>
									{explanation.path}:{explanation.startLine}
								</button>
								<span className={styles.says}>
									<BacktickText text={explanation.says.join(" ")} />
								</span>
							</div>
						))}
					</div>
				</div>
			))}
		</section>
	);
}
