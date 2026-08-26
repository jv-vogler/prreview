import type { ExplanationDto, ReviewFindingDto } from "@dto/ReviewDto";
import { type ReactNode, useState } from "react";
import type { Topic } from "../../domain/explanation/topics";
import { ExplanationsPanel } from "./explanations/ExplanationsPanel";
import type { FindingActions } from "./findings/FindingActions";
import { FindingWorklist } from "./findings/FindingWorklist";
import styles from "./ReviewSidebar.module.css";

type SidebarTab = "comments" | "explanations";

export interface ReviewSidebarProps {
	width: number;
	findings: readonly ReviewFindingDto[];
	explanations: readonly ExplanationDto[];
	expandedFindingIds: ReadonlySet<string>;
	onJumpToFinding(finding: ReviewFindingDto): void;
	onCollapseFinding(findingId: string): void;
	actions: FindingActions;
	onJumpToExplanation(explanation: ExplanationDto): void;
	onToggleTopic(topic: Topic): void;
	publishControl?: ReactNode;
}

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
