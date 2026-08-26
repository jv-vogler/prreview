import type {
	ReviewCommentDto,
	ReviewFindingKindDto,
	ReviewTierDto,
} from "@dto/ReviewDto";
import {
	AlertFillIcon,
	CommentIcon,
	QuestionIcon,
} from "@primer/octicons-react";
import { useState } from "react";
import { Collapsible } from "../../layout/Collapsible";
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
					data-kind={markerKind(collapsed)}
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
 * One open balloon. The collapse control does not remove the card: it starts
 * the way out, and the caller's own unmount waits for `Collapsible` to say
 * the animation has finished.
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
		<Collapsible open={!closing} onClosed={onCollapse}>
			<CommentBalloon
				comment={comment}
				onCollapse={() => setClosing(true)}
				actions={actions}
			/>
		</Collapsible>
	);
}

const TIER_SEVERITY: Record<ReviewTierDto, number> = {
	blocker: 0,
	"should-fix": 1,
	suggestion: 2,
	nitpick: 3,
};

/** The worst tier under this marker, or nothing when it holds only questions. */
function worstTier(
	comments: readonly ReviewCommentDto[],
): ReviewTierDto | undefined {
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
	return worst;
}

/**
 * `question` only when there is nothing but questions here, so the marker
 * says the same thing through the same attribute the balloon, the row and
 * the sidebar count all use.
 */
function markerKind(
	comments: readonly ReviewCommentDto[],
): ReviewFindingKindDto | undefined {
	return comments.every((comment) => comment.kind === "question")
		? "question"
		: undefined;
}
