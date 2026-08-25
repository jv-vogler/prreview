import type { ExplanationDto, ReviewCommentDto } from "@dto/ReviewDto";
import { BookIcon } from "@primer/octicons-react";
import type { ReactNode } from "react";
import { countByTier } from "../../domain/review/countByTier";
import type { CommentActions } from "./CommentActions";
import { CommentBalloon } from "./CommentBalloon";
import styles from "./CommentWorklist.module.css";
import { BacktickText } from "./ExplanationBalloon";
import { REVIEW_TIER_LABEL, REVIEW_TIER_ORDER } from "./reviewTier";

export interface CommentWorklistProps {
	comments: readonly ReviewCommentDto[];
	/** explanations the diff cannot anchor; listed here so they never vanish */
	unplacedExplanations: readonly ExplanationDto[];
	expandedCommentIds: ReadonlySet<string>;
	/** row clicked: expand it and, if it has a place on the diff, scroll there */
	onJumpTo(comment: ReviewCommentDto): void;
	/** the balloon's own collapse control: just closes it, no scrolling */
	onCollapse(commentId: string): void;
	actions: CommentActions;
	/** the publish control docks at the panel's foot, under the worklist */
	publishControl?: ReactNode;
}

/**
 * The comment sidebar worklist (TASK-044, REQ-005): per-tier counts, then
 * three sections so nothing is ever silently missing — the on-diff review
 * comments, anything `clamped`/`unplaceable` that the diff cannot show
 * (REQ-010), and pre-existing findings in their own lane (REQ-011).
 */
export function CommentWorklist({
	comments,
	unplacedExplanations,
	expandedCommentIds,
	onJumpTo,
	onCollapse,
	actions,
	publishControl,
}: CommentWorklistProps) {
	const active = comments.filter((comment) => !comment.deleted);
	const dismissed = comments.filter((comment) => comment.deleted);
	const reviewComments = active.filter((comment) => comment.lane === "review");
	const onDiff = reviewComments.filter(
		(comment) => comment.placement.kind === "exact",
	);
	const offDiff = reviewComments.filter(
		(comment) => comment.placement.kind !== "exact",
	);
	const preExisting = active.filter(
		(comment) => comment.lane === "pre-existing",
	);
	const counts = countByTier(reviewComments);

	return (
		<aside className={styles.panel} aria-label="Review comments">
			<h2 className={styles.heading}>Comments</h2>
			{comments.length === 0 ? (
				<p className={styles.empty}>No comments.</p>
			) : (
				<ul className={styles.counts}>
					{REVIEW_TIER_ORDER.filter((tier) => counts[tier] > 0).map((tier) => (
						<li key={tier} className={styles.count} data-tier={tier}>
							{counts[tier]} {REVIEW_TIER_LABEL[tier]}
						</li>
					))}
				</ul>
			)}
			<CommentSection
				title={null}
				comments={onDiff}
				expandedCommentIds={expandedCommentIds}
				onJumpTo={onJumpTo}
				onCollapse={onCollapse}
				actions={actions}
			/>
			{offDiff.length > 0 && (
				<CommentSection
					title="Not shown in the diff"
					comments={offDiff}
					expandedCommentIds={expandedCommentIds}
					onJumpTo={onJumpTo}
					onCollapse={onCollapse}
					actions={actions}
				/>
			)}
			{preExisting.length > 0 && (
				<CommentSection
					title="Pre-existing (noticed nearby, not part of this change)"
					comments={preExisting}
					expandedCommentIds={expandedCommentIds}
					onJumpTo={onJumpTo}
					onCollapse={onCollapse}
					actions={actions}
				/>
			)}
			{dismissed.length > 0 && (
				<CommentSection
					title="Dismissed"
					lane="dismissed"
					comments={dismissed}
					expandedCommentIds={expandedCommentIds}
					onJumpTo={onJumpTo}
					onCollapse={onCollapse}
					actions={actions}
				/>
			)}
			{unplacedExplanations.length > 0 && (
				<section className={styles.section}>
					<h3 className={styles.sectionTitle}>
						Explanations not shown in the diff
					</h3>
					<ul className={styles.list}>
						{unplacedExplanations.map((explanation) => (
							<li
								key={explanation.id}
								className={styles.explanationEntry}
								data-unplaced-explanation={explanation.id}
							>
								<p className={styles.explanationPlace}>
									<BookIcon size={14} />
									{explanation.path}:{explanation.startLine}
								</p>
								{explanation.says.map((sentence, index) => (
									// biome-ignore lint/suspicious/noArrayIndexKey: says never reorders
									<p key={index} className={styles.explanationSays}>
										<BacktickText text={sentence} />
									</p>
								))}
							</li>
						))}
					</ul>
				</section>
			)}
			{publishControl !== undefined && (
				<div className={styles.publishDock}>{publishControl}</div>
			)}
		</aside>
	);
}

function CommentSection({
	title,
	lane,
	comments,
	expandedCommentIds,
	onJumpTo,
	onCollapse,
	actions,
}: {
	title: string | null;
	lane?: string;
	comments: readonly ReviewCommentDto[];
	expandedCommentIds: ReadonlySet<string>;
	onJumpTo(comment: ReviewCommentDto): void;
	onCollapse(commentId: string): void;
	actions: CommentActions;
}) {
	if (comments.length === 0) {
		return null;
	}
	return (
		<section className={styles.section} data-lane={lane}>
			{title !== null && <h3 className={styles.sectionTitle}>{title}</h3>}
			<ul className={styles.list}>
				{comments.map((comment) => (
					<li key={comment.id}>
						<button
							type="button"
							className={styles.row}
							data-comment-row={comment.id}
							data-tier={comment.tier}
							onClick={() => onJumpTo(comment)}
						>
							<span className={styles.rowTier}>
								{REVIEW_TIER_LABEL[comment.tier]}
							</span>
							<span className={styles.rowTitle}>{comment.title}</span>
						</button>
						{expandedCommentIds.has(comment.id) && (
							<div className={styles.rowExpanded}>
								<CommentBalloon
									comment={comment}
									onCollapse={() => onCollapse(comment.id)}
									actions={actions}
								/>
							</div>
						)}
					</li>
				))}
			</ul>
		</section>
	);
}
