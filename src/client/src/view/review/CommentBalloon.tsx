import type { ReviewCommentDto } from "@dto/ReviewDto";
import { CheckCircleIcon, QuestionIcon, XIcon } from "@primer/octicons-react";
import styles from "./CommentBalloon.module.css";
import { CommentMarkdown } from "./CommentMarkdown";
import { REVIEW_TIER_LABEL } from "./reviewTier";

export interface CommentBalloonProps {
	comment: ReviewCommentDto;
	onCollapse(): void;
}

/**
 * One comment, expanded (TASK-043): tier and lane, the body as markdown
 * (its own alert block included), the evidence block if there is one, and
 * the proof line for the reviewer's own triage — never pasted into GitHub.
 */
export function CommentBalloon({ comment, onCollapse }: CommentBalloonProps) {
	return (
		<div
			className={styles.balloon}
			data-comment-id={comment.id}
			data-tier={comment.tier}
			role="note"
		>
			<div className={styles.header}>
				<span className={styles.tier}>{REVIEW_TIER_LABEL[comment.tier]}</span>
				{comment.lane === "pre-existing" && (
					<span className={styles.lane}>Pre-existing</span>
				)}
				<span className={styles.title}>{comment.title}</span>
				<button
					type="button"
					className={styles.collapse}
					aria-label="Collapse comment"
					onClick={onCollapse}
				>
					<XIcon size={14} />
				</button>
			</div>
			<CommentMarkdown body={comment.body} />
			{comment.evidence !== undefined && (
				<CommentMarkdown body={comment.evidence} />
			)}
			<p className={styles.proof}>
				{comment.verified ? (
					<CheckCircleIcon size={12} />
				) : (
					<QuestionIcon size={12} />
				)}
				{comment.proof}
			</p>
		</div>
	);
}
