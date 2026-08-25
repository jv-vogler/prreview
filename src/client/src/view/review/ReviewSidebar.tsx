import type { ExplanationDto, ReviewCommentDto } from "@dto/ReviewDto";
import { type ReactNode, useState } from "react";
import type { Topic } from "../../domain/review/topics";
import type { CommentActions } from "./CommentActions";
import { CommentWorklist } from "./CommentWorklist";
import { ExplanationsPanel } from "./ExplanationsPanel";
import styles from "./ReviewSidebar.module.css";

type SidebarTab = "comments" | "explanations";

export interface ReviewSidebarProps {
	comments: readonly ReviewCommentDto[];
	explanations: readonly ExplanationDto[];
	expandedCommentIds: ReadonlySet<string>;
	onJumpToComment(comment: ReviewCommentDto): void;
	onCollapseComment(commentId: string): void;
	actions: CommentActions;
	onJumpToExplanation(explanation: ExplanationDto): void;
	onToggleTopic(topic: Topic): void;
	/** the publish control docks at the panel's foot, under either tab */
	publishControl?: ReactNode;
}

/**
 * The right panel, two readings of the same pass: Comments is the worklist
 * to act on (TASK-044, REQ-005), Explanations is the PR's story to read.
 * One tab bar instead of stacked sections, because the two are different
 * modes — triaging and orienting — and never wanted on screen together.
 */
export function ReviewSidebar({
	comments,
	explanations,
	expandedCommentIds,
	onJumpToComment,
	onCollapseComment,
	actions,
	onJumpToExplanation,
	onToggleTopic,
	publishControl,
}: ReviewSidebarProps) {
	const [tab, setTab] = useState<SidebarTab>("comments");
	const active: SidebarTab = explanations.length === 0 ? "comments" : tab;
	return (
		<aside className={styles.panel} aria-label="Review sidebar">
			{explanations.length > 0 ? (
				<div className={styles.tabs} role="tablist">
					<Tab
						label="Comments"
						count={comments.length}
						selected={active === "comments"}
						onSelect={() => setTab("comments")}
					/>
					<Tab
						label="Explanations"
						count={explanations.length}
						selected={active === "explanations"}
						onSelect={() => setTab("explanations")}
					/>
				</div>
			) : (
				<h2 className={styles.heading}>Comments</h2>
			)}
			<div className={styles.content} role="tabpanel">
				{active === "comments" ? (
					<CommentWorklist
						comments={comments}
						expandedCommentIds={expandedCommentIds}
						onJumpTo={onJumpToComment}
						onCollapse={onCollapseComment}
						actions={actions}
					/>
				) : (
					<ExplanationsPanel
						explanations={explanations}
						onJumpTo={onJumpToExplanation}
						onToggleTopic={onToggleTopic}
					/>
				)}
			</div>
			{publishControl !== undefined && (
				<div className={styles.publishDock}>{publishControl}</div>
			)}
		</aside>
	);
}

function Tab({
	label,
	count,
	selected,
	onSelect,
}: {
	label: string;
	count: number;
	selected: boolean;
	onSelect(): void;
}) {
	return (
		<button
			type="button"
			role="tab"
			aria-selected={selected}
			className={styles.tab}
			onClick={onSelect}
		>
			{label}
			<span className={styles.tabCount}>{count}</span>
		</button>
	);
}
