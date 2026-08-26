import type { ExplanationDto } from "@dto/ReviewDto";
import { ChevronDownIcon, ChevronRightIcon } from "@primer/octicons-react";
import { useState } from "react";
import { topicColorsFor } from "../../../domain/explanation/topicColors";
import {
	type Topic,
	topicPaths,
	topicSummary,
	topicSummaryLeads,
	topicsFor,
} from "../../../domain/explanation/topics";
import { Collapsible } from "../../layout/Collapsible";
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
 * every card into a read-through summary of the PR, in the order the diff
 * itself runs (explanationOrder.ts). Topics first — one chip, its shared
 * color, its own account, and one jump per anchored change, which is how an
 * intent spanning several files stays one unit — then the standalone
 * explanations under their own paths. An explanation the diff cannot anchor
 * is listed too, marked instead of vanishing.
 *
 * A topic folds to its heading, because a long pass is a long panel and the
 * reader usually wants one intent at a time.
 */
export function ExplanationsPanel({
	explanations,
	onJumpTo,
	onToggleTopic,
}: ExplanationsPanelProps) {
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
				<TopicSection
					key={topic.label}
					topic={topic}
					color={colors.get(topic.label)}
					onJumpTo={onJumpTo}
					onToggleTopic={onToggleTopic}
				/>
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

function TopicSection({
	topic,
	color,
	onJumpTo,
	onToggleTopic,
}: {
	topic: Topic;
	color?: number;
	onJumpTo(explanation: ExplanationDto): void;
	onToggleTopic(topic: Topic): void;
}) {
	const [open, setOpen] = useState(true);
	const highlighted = useHighlightedExplanations();
	const paths = topicPaths(topic);
	// the account above already says these; an entry adds what it does not
	const said = new Set(topicSummaryLeads(topic));
	return (
		<section className={styles.topic} data-topic-section={topic.label}>
			<div className={styles.topicHead}>
				<button
					type="button"
					className={styles.fold}
					aria-expanded={open}
					aria-label={open ? `Fold ${topic.label}` : `Unfold ${topic.label}`}
					onClick={() => setOpen((current) => !current)}
				>
					{open ? (
						<ChevronDownIcon size={16} />
					) : (
						<ChevronRightIcon size={16} />
					)}
				</button>
				<TopicChip
					label={topic.label}
					color={color}
					wrap
					pressed={topic.explanations.every((explanation) =>
						highlighted.has(explanation.id),
					)}
					onToggle={() => onToggleTopic(topic)}
				/>
				<span className={styles.fileCount}>
					{paths.length} {paths.length === 1 ? "file" : "files"}
				</span>
			</div>
			<Collapsible open={open}>
				<div className={styles.topicBody}>
					<p className={styles.summary}>
						<BacktickText text={topicSummary(topic)} />
					</p>
					<ul className={styles.entries}>
						{topic.explanations.map((explanation) => (
							<Entry
								key={explanation.id}
								explanation={explanation}
								skipSaid={said}
								onJumpTo={onJumpTo}
							/>
						))}
					</ul>
				</div>
			</Collapsible>
		</section>
	);
}

function Entry({
	explanation,
	skipSaid,
	onJumpTo,
}: {
	explanation: ExplanationDto;
	/** sentences the topic's account above already carries */
	skipSaid?: ReadonlySet<string>;
	onJumpTo(explanation: ExplanationDto): void;
}) {
	const place = `${explanation.path}:${explanation.startLine}`;
	const says = explanation.says.filter(
		(sentence) => skipSaid?.has(sentence) !== true,
	);
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
			{says.length > 0 && (
				<p className={styles.says}>
					<BacktickText text={says.join(" ")} />
				</p>
			)}
		</li>
	);
}
