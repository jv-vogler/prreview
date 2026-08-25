import type { ReviewPassDto } from "@dto/ReviewDto";
import { ChevronDownIcon, ChevronRightIcon } from "@primer/octicons-react";
import { useMemo } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Collapsible } from "../layout/Collapsible";
import styles from "./OverviewPanel.module.css";
import { linkTopicMentions, topicFromHref } from "./overviewTopicMentions";
import { TopicChip } from "./TopicChip";

/**
 * The pass's lede, above the diff (TASK-042, REQ-003): the business-level
 * prose first, then the verdict as the closing line under it, colored by
 * the scope check's outcome so the conclusion reads at a glance. Read once,
 * then folded away — the diff is the workspace, so the whole account
 * collapses to a single line that keeps the verdict visible.
 *
 * The overview is markdown, not text. The agent writes paragraphs separated
 * by blank lines and backticks around names worth going to look for, and
 * without a renderer both arrive as literal characters in a single wall.
 */
export function OverviewPanel({
	pass,
	topicColors,
	onToggleTopic,
	folded,
	onToggleFold,
}: {
	pass: ReviewPassDto;
	/** each topic label's palette slot (topicColors.ts) */
	topicColors: ReadonlyMap<string, number>;
	/** an inline topic chip toggles the highlight on its balloons */
	onToggleTopic(label: string): void;
	folded: boolean;
	onToggleFold(): void;
}) {
	// the prompt asks the agent to mention each topic label verbatim; the
	// mention renders as that topic's colored chip, tying the summary to
	// the balloons wearing the same color on the diff
	const overview = useMemo(
		() => linkTopicMentions(pass.overview, [...topicColors.keys()]),
		[pass.overview, topicColors],
	);
	return (
		<section className={styles.panel}>
			<button
				type="button"
				className={styles.foldControl}
				aria-expanded={!folded}
				onClick={onToggleFold}
			>
				<span className={styles.foldChevron}>
					{folded ? (
						<ChevronRightIcon size={16} />
					) : (
						<ChevronDownIcon size={16} />
					)}
				</span>
				<span className={styles.foldLabel}>Overview</span>
				{folded && (
					<span
						className={styles.foldedVerdict}
						data-scope={pass.scope ?? "neutral"}
					>
						{pass.verdict}
					</span>
				)}
			</button>
			<Collapsible open={!folded}>
				<div className={styles.foldable}>
					<div className={styles.body}>
						<div className={styles.prose}>
							<Markdown
								remarkPlugins={[remarkGfm]}
								components={{
									a: ({ href, children }) => {
										const topic =
											href === undefined ? null : topicFromHref(href);
										if (topic === null) {
											return <a href={href}>{children}</a>;
										}
										return (
											<TopicChip
												label={topic}
												color={topicColors.get(topic)}
												onToggle={() => onToggleTopic(topic)}
											/>
										);
									},
								}}
							>
								{overview}
							</Markdown>
						</div>
						{pass.ticket !== null && (
							<aside className={styles.ticket}>
								<h2 className={styles.label}>Ticket</h2>
								<p className={styles.ticketText}>{pass.ticket}</p>
							</aside>
						)}
					</div>
					<div className={styles.verdictRow}>
						<h2 className={styles.verdictLabel}>Verdict</h2>
						<p className={styles.verdict} data-scope={pass.scope ?? "neutral"}>
							{pass.verdict}
						</p>
					</div>
				</div>
			</Collapsible>
		</section>
	);
}
