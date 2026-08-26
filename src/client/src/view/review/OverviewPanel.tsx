import type { ReviewPassDto } from "@dto/ReviewDto";
import { ChevronDownIcon, ChevronRightIcon } from "@primer/octicons-react";
import { useMemo } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Collapsible } from "../layout/Collapsible";
import {
	linkTopicMentions,
	topicFromHref,
} from "./explanations/overviewTopicMentions";
import { TopicChip } from "./explanations/TopicChip";
import styles from "./OverviewPanel.module.css";

export function OverviewPanel({
	pass,
	topicColors,
	onToggleTopic,
	folded,
	onToggleFold,
}: {
	pass: ReviewPassDto;
	topicColors: ReadonlyMap<string, number>;
	onToggleTopic(label: string): void;
	folded: boolean;
	onToggleFold(): void;
}) {
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
