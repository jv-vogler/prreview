import type { ReviewCommentDto, ReviewTierDto } from "@dto/ReviewDto";
import {
	AlertFillIcon,
	CommentIcon,
	QuestionIcon,
} from "@primer/octicons-react";
import { useState } from "react";
import type { CommentActions } from "./CommentActions";
import { CommentBalloon } from "./CommentBalloon";
import styles from "./DiffCommentAnnotation.module.css";

export interface DiffCommentAnnotationProps {
	commentIds: readonly string[];
	commentsById: ReadonlyMap<string, ReviewCommentDto>;
	expandedCommentIds: ReadonlySet<string>;
	onToggle(commentId: string): void;
	actions: CommentActions;
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
	actions,
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
					<MarkerIcon comments={collapsed} />
					{collapsed.length > 1 && (
						<span className={styles.count}>{collapsed.length}</span>
					)}
				</button>
			)}
			{expanded.map((comment) => (
				<ExpandingBalloon
					key={comment.id}
					comment={comment}
					onCollapse={() => onToggle(comment.id)}
					actions={actions}
				/>
			))}
		</div>
	);
}

/** A lone question shows a question mark; anything else keeps the comment marks. */
function MarkerIcon({ comments }: { comments: readonly ReviewCommentDto[] }) {
	if (comments.length > 1) {
		return <AlertFillIcon size={14} />;
	}
	if (comments[0]?.kind === "question") {
		return <QuestionIcon size={14} />;
	}
	return <CommentIcon size={14} />;
}

/**
 * One open balloon, in a grid whose single row animates between 0fr and 1fr —
 * the only way to animate to a height nobody has measured, since the card's is
 * whatever its markdown comes to. The inner element does the clipping, so the
 * card is revealed rather than squashed.
 *
 * Closing is owned here rather than by the caller: React would unmount the
 * card the instant it left the expanded set, leaving nothing to animate, so
 * the collapse is held until the exit animation reports it has finished.
 */
function ExpandingBalloon({
	comment,
	onCollapse,
	actions,
}: {
	comment: ReviewCommentDto;
	onCollapse(): void;
	actions: CommentActions;
}) {
	const [closing, setClosing] = useState(false);

	return (
		<div
			className={styles.expander}
			data-closing={closing || undefined}
			onAnimationEnd={(event) => {
				// the card's own animations bubble through here too
				if (closing && event.target === event.currentTarget) {
					onCollapse();
				}
			}}
		>
			<div className={styles.expanderClip}>
				<CommentBalloon
					comment={comment}
					onCollapse={() => setClosing(true)}
					actions={actions}
				/>
			</div>
		</div>
	);
}

const TIER_SEVERITY: Record<ReviewTierDto, number> = {
	blocker: 0,
	"should-fix": 1,
	suggestion: 2,
	nitpick: 3,
};

/**
 * The marker's colour. Questions carry no tier, so a marker holding only
 * questions says so instead of borrowing the mildest tier's colour.
 */
function worstTier(comments: readonly ReviewCommentDto[]): string {
	let worst: ReviewTierDto | undefined;
	for (const comment of comments) {
		if (comment.tier === undefined) {
			continue;
		}
		if (
			worst === undefined ||
			TIER_SEVERITY[comment.tier] < TIER_SEVERITY[worst]
		) {
			worst = comment.tier;
		}
	}
	return worst ?? "question";
}
