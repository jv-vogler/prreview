import type { ReviewCommentDto } from "@dto/ReviewDto";
import { AlertFillIcon, CommentIcon } from "@primer/octicons-react";
import { CommentBalloon } from "./CommentBalloon";
import styles from "./DiffCommentAnnotation.module.css";

export interface DiffCommentAnnotationProps {
	commentIds: readonly string[];
	commentsById: ReadonlyMap<string, ReviewCommentDto>;
	expandedCommentIds: ReadonlySet<string>;
	onToggle(commentId: string): void;
}

/**
 * The gutter marker for one rendered diff line (TASK-043, REQ-004):
 * collapsed by default, showing the worst tier present and how many
 * comments anchor here; each comment opens into its own balloon
 * independently, so the reader controls exactly how many are open at once.
 */
export function DiffCommentAnnotation({
	commentIds,
	commentsById,
	expandedCommentIds,
	onToggle,
}: DiffCommentAnnotationProps) {
	const comments = commentIds
		.map((id) => commentsById.get(id))
		.filter((comment): comment is ReviewCommentDto => comment !== undefined);
	if (comments.length === 0) {
		return null;
	}
	const collapsed = comments.filter(
		(comment) => !expandedCommentIds.has(comment.id),
	);
	const expanded = comments.filter((comment) =>
		expandedCommentIds.has(comment.id),
	);

	return (
		<div className={styles.annotation}>
			{collapsed.length > 0 && (
				<button
					type="button"
					className={styles.marker}
					data-comment-marker="true"
					data-tier={worstTier(collapsed)}
					onClick={() => {
						for (const comment of collapsed) {
							onToggle(comment.id);
						}
					}}
				>
					{collapsed.length === 1 ? (
						<CommentIcon size={14} />
					) : (
						<AlertFillIcon size={14} />
					)}
					{collapsed.length > 1 && (
						<span className={styles.count}>{collapsed.length}</span>
					)}
				</button>
			)}
			{expanded.map((comment) => (
				<CommentBalloon
					key={comment.id}
					comment={comment}
					onCollapse={() => onToggle(comment.id)}
				/>
			))}
		</div>
	);
}

const TIER_SEVERITY: Record<string, number> = {
	blocker: 0,
	"should-fix": 1,
	suggestion: 2,
	nitpick: 3,
};

function worstTier(comments: readonly ReviewCommentDto[]): string {
	return comments.reduce(
		(worst, comment) =>
			TIER_SEVERITY[comment.tier] < TIER_SEVERITY[worst] ? comment.tier : worst,
		comments[0]?.tier ?? "nitpick",
	);
}
