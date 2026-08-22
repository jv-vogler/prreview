import type { PublishedRecordDto, ReviewCommentDto } from "@dto/ReviewDto";
import { useMemo } from "react";
import type { PublishExclusionReason } from "../../domain/review/publishSummary";
import { summarizePublish } from "../../domain/review/publishSummary";
import styles from "./PublishControl.module.css";

const EXCLUSION_COPY: Record<PublishExclusionReason, string> = {
	"pre-existing": "predates this change",
	unplaceable: "not anchorable in this diff",
};

export interface PublishControlProps {
	comments: readonly ReviewCommentDto[];
	published: PublishedRecordDto | null;
	publishing: boolean;
	error: string | null;
	onPublish: () => void;
}

/**
 * States, before sending, exactly what a publish will do (TASK-052): the
 * count going up and every comment left behind, with its reason — a
 * publish that silently drops a finding is the failure this control exists
 * to prevent. Sending is one click away, not behind a second confirm step;
 * the summary below is always on screen, never hidden until asked for.
 */
export function PublishControl({
	comments,
	published,
	publishing,
	error,
	onPublish,
}: PublishControlProps) {
	const { publishable, excluded } = useMemo(
		() => summarizePublish(comments),
		[comments],
	);
	return (
		<div className={styles.panel}>
			<p className={styles.summary}>
				{publishable.length === 0
					? "Nothing publishable yet."
					: `${publishable.length} comment${publishable.length === 1 ? "" : "s"} will be published.`}
				{excluded.length > 0 &&
					` ${excluded.length} left behind, never sent to GitHub.`}
			</p>
			{excluded.length > 0 && (
				<ul className={styles.excludedList}>
					{excluded.map(({ comment, reason }) => (
						<li key={comment.id}>
							{comment.title} — {EXCLUSION_COPY[reason]}
						</li>
					))}
				</ul>
			)}
			<button
				type="button"
				className={styles.publishButton}
				disabled={publishing || publishable.length === 0}
				onClick={onPublish}
			>
				{publishing ? "Sending…" : "Send review"}
			</button>
			{error !== null && (
				<p className={styles.error} role="alert">
					{error}
				</p>
			)}
			{published !== null && (
				<p className={styles.published}>
					Published as a pending review —{" "}
					<a href={published.htmlUrl} target="_blank" rel="noreferrer">
						view on GitHub
					</a>
					.
				</p>
			)}
		</div>
	);
}
