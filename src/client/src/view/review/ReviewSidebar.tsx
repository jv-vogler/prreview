import type { ExplanationDto, ReviewFindingDto } from "@dto/ReviewDto";
import { type ReactNode, useState } from "react";
import type { Topic } from "../../domain/explanation/topics";
import type { FindingActions } from "./comments/FindingActions";
import { FindingWorklist } from "./comments/FindingWorklist";
import { ExplanationsPanel } from "./explanations/ExplanationsPanel";
import styles from "./ReviewSidebar.module.css";

type SidebarTab = "comments" | "explanations";

export interface ReviewSidebarProps {
	/** the reader's own width for this panel, dragged on the seam beside it */
	width: number;
	findings: readonly ReviewFindingDto[];
	explanations: readonly ExplanationDto[];
	expandedFindingIds: ReadonlySet<string>;
	onJumpToFinding(finding: ReviewFindingDto): void;
	onCollapseFinding(findingId: string): void;
	actions: FindingActions;
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
	width,
	findings,
	explanations,
	expandedFindingIds,
	onJumpToFinding,
	onCollapseFinding,
	actions,
	onJumpToExplanation,
	onToggleTopic,
	publishControl,
}: ReviewSidebarProps) {
	const [tab, setTab] = useState<SidebarTab>("comments");
	const active: SidebarTab = explanations.length === 0 ? "comments" : tab;
	return (
		<aside
			className={styles.panel}
			style={{ width }}
			aria-label="Review sidebar"
		>
			{explanations.length > 0 ? (
				<div className={styles.tabs} role="tablist">
					<Tab
						label="Comments"
						count={findings.length}
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
					<FindingWorklist
						findings={findings}
						expandedFindingIds={expandedFindingIds}
						onJumpTo={onJumpToFinding}
						onCollapse={onCollapseFinding}
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
