import type { ReviewCommentDto } from "@dto/ReviewDto";
import {
	CheckCircleIcon,
	PencilIcon,
	QuestionIcon,
	TrashIcon,
	UndoIcon,
	XIcon,
} from "@primer/octicons-react";
import { useState } from "react";
import type { CommentActions } from "./CommentActions";
import styles from "./CommentBalloon.module.css";
import { CommentMarkdown } from "./CommentMarkdown";
import { ReworkControl } from "./ReworkControl";
import { REVIEW_TIER_LABEL } from "./reviewTier";

export interface CommentBalloonProps {
	comment: ReviewCommentDto;
	onCollapse(): void;
	actions: CommentActions;
}

/**
 * One comment, expanded (TASK-043): tier and lane, the body as markdown
 * (its own alert block included), the evidence block if there is one, and
 * the proof line for the reviewer's own triage — never pasted into GitHub.
 * The reader can also edit the body in place, delete the comment, and ask
 * for a rework (TASK-046, TASK-047, TASK-049).
 */
export function CommentBalloon({
	comment,
	onCollapse,
	actions,
}: CommentBalloonProps) {
	const [editing, setEditing] = useState(false);
	const dismissed = comment.deleted;

	return (
		<div
			className={styles.balloon}
			data-comment-id={comment.id}
			data-tier={comment.tier}
			data-dismissed={dismissed}
			role="note"
		>
			<div className={styles.header}>
				<span className={styles.tier}>{REVIEW_TIER_LABEL[comment.tier]}</span>
				{comment.lane === "pre-existing" && (
					<span className={styles.lane}>Pre-existing</span>
				)}
				{comment.edited && <span className={styles.lane}>Edited</span>}
				{dismissed && <span className={styles.lane}>Dismissed</span>}
				<span className={styles.title}>{comment.title}</span>
				{dismissed ? (
					<button
						type="button"
						className={styles.iconButton}
						aria-label="Restore comment"
						onClick={() => actions.onRestore(comment.id)}
					>
						<UndoIcon size={14} />
					</button>
				) : (
					<>
						<button
							type="button"
							className={styles.iconButton}
							aria-label="Edit comment"
							aria-pressed={editing}
							onClick={() => setEditing((current) => !current)}
						>
							<PencilIcon size={14} />
						</button>
						<button
							type="button"
							className={styles.iconButton}
							aria-label="Delete comment"
							onClick={() => actions.onDelete(comment.id)}
						>
							<TrashIcon size={14} />
						</button>
					</>
				)}
				<button
					type="button"
					className={styles.collapse}
					aria-label="Collapse comment"
					onClick={onCollapse}
				>
					<XIcon size={14} />
				</button>
			</div>
			{editing && !dismissed ? (
				<EditBody
					initialBody={comment.body}
					onDone={(body) => {
						setEditing(false);
						if (body !== comment.body) {
							actions.onEdit(comment.id, body);
						}
					}}
				/>
			) : (
				<CommentMarkdown body={comment.body} />
			)}
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
			{!dismissed && actions.onRework !== undefined && (
				<ReworkControl comment={comment} actions={actions} />
			)}
		</div>
	);
}

/** A markdown textarea that commits on blur (TASK-047's exact shape). */
function EditBody({
	initialBody,
	onDone,
}: {
	initialBody: string;
	onDone(body: string): void;
}) {
	const [body, setBody] = useState(initialBody);
	return (
		<textarea
			className={styles.editor}
			value={body}
			onChange={(event) => setBody(event.target.value)}
			onBlur={() => onDone(body)}
		/>
	);
}
