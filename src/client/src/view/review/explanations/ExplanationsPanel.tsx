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

export interface ExplanationsPanelProps {
	explanations: readonly ExplanationDto[];
	onJumpTo(explanation: ExplanationDto): void;
	onToggleTopic(topic: Topic): void;
}

export function ExplanationsPanel({
	explanations,
	onJumpTo,
	onToggleTopic,
}: ExplanationsPanelProps) {
	if (explanations.length === 0) {
		return <p className={styles.empty}>No explanations.</p>;
	}
	const topics = topicsFor(explanations);
	const colors = topicColorsFor(explanations);
	const standalone = explanations.filter(
		(explanation) => explanation.topic === undefined,
	);
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
				<button
					type="button"
					className={styles.topicToggle}
					data-topic-color={color}
					aria-pressed={topic.explanations.every((explanation) =>
						highlighted.has(explanation.id),
					)}
					onClick={() => onToggleTopic(topic)}
				>
					<span className={styles.dot} aria-hidden="true" />
					{topic.label}
				</button>
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
