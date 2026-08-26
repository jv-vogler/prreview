import type { ReviewFindingDto } from "@dto/ReviewDto";
import {
	countByTier,
	countQuestions,
} from "../../../domain/finding/countByTier";
import { Collapsible } from "../../layout/Collapsible";
import {
	findingTierLabel,
	REVIEW_TIER_LABEL,
	REVIEW_TIER_ORDER,
} from "../shared/reviewTier";
import type { FindingActions } from "./FindingActions";
import { FindingBalloon } from "./FindingBalloon";
import styles from "./FindingWorklist.module.css";

export interface FindingWorklistProps {
	findings: readonly ReviewFindingDto[];
	expandedFindingIds: ReadonlySet<string>;
	onJumpTo(finding: ReviewFindingDto): void;
	onCollapse(findingId: string): void;
	actions: FindingActions;
}

export function FindingWorklist({
	findings,
	expandedFindingIds,
	onJumpTo,
	onCollapse,
	actions,
}: FindingWorklistProps) {
	const active = findings.filter((finding) => !finding.deleted);
	const dismissed = findings.filter((finding) => finding.deleted);
	const reviewLaneFindings = active.filter(
		(finding) => finding.lane === "review",
	);
	const onDiff = reviewLaneFindings.filter(
		(finding) => finding.placement.kind === "exact",
	);
	const offDiff = reviewLaneFindings.filter(
		(finding) => finding.placement.kind !== "exact",
	);
	const preExisting = active.filter(
		(finding) => finding.lane === "pre-existing",
	);
	const counts = countByTier(reviewLaneFindings);
	const questions = countQuestions(reviewLaneFindings);

	return (
		<div>
			{findings.length === 0 ? (
				<p className={styles.empty}>No findings.</p>
			) : (
				<ul className={styles.counts}>
					{REVIEW_TIER_ORDER.filter((tier) => counts[tier] > 0).map((tier) => (
						<li key={tier} className={styles.count} data-tier={tier}>
							{counts[tier]} {REVIEW_TIER_LABEL[tier]}
						</li>
					))}
					{questions > 0 && (
						<li className={styles.count} data-kind="question">
							{questions} {questions === 1 ? "Question" : "Questions"}
						</li>
					)}
				</ul>
			)}
			<FindingSection
				title={null}
				findings={onDiff}
				expandedFindingIds={expandedFindingIds}
				onJumpTo={onJumpTo}
				onCollapse={onCollapse}
				actions={actions}
			/>
			{offDiff.length > 0 && (
				<FindingSection
					title="Not shown in the diff"
					findings={offDiff}
					expandedFindingIds={expandedFindingIds}
					onJumpTo={onJumpTo}
					onCollapse={onCollapse}
					actions={actions}
				/>
			)}
			{preExisting.length > 0 && (
				<FindingSection
					title="Pre-existing (noticed nearby, not part of this change)"
					findings={preExisting}
					expandedFindingIds={expandedFindingIds}
					onJumpTo={onJumpTo}
					onCollapse={onCollapse}
					actions={actions}
				/>
			)}
			{dismissed.length > 0 && (
				<FindingSection
					title="Dismissed"
					lane="dismissed"
					findings={dismissed}
					expandedFindingIds={expandedFindingIds}
					onJumpTo={onJumpTo}
					onCollapse={onCollapse}
					actions={actions}
				/>
			)}
		</div>
	);
}

function FindingSection({
	title,
	lane,
	findings,
	expandedFindingIds,
	onJumpTo,
	onCollapse,
	actions,
}: {
	title: string | null;
	lane?: string;
	findings: readonly ReviewFindingDto[];
	expandedFindingIds: ReadonlySet<string>;
	onJumpTo(finding: ReviewFindingDto): void;
	onCollapse(findingId: string): void;
	actions: FindingActions;
}) {
	if (findings.length === 0) {
		return null;
	}
	return (
		<section className={styles.section} data-lane={lane}>
			{title !== null && <h3 className={styles.sectionTitle}>{title}</h3>}
			<ul className={styles.list}>
				{findings.map((finding) => (
					<li key={finding.id}>
						<button
							type="button"
							className={styles.row}
							data-finding-row={finding.id}
							data-tier={finding.tier}
							data-kind={finding.kind}
							data-published={finding.published || undefined}
							onClick={() => onJumpTo(finding)}
						>
							<span className={styles.rowTier}>
								{findingTierLabel(finding)}
							</span>
							<span className={styles.rowTitle}>{finding.title}</span>
							{finding.published && (
								<span className={styles.rowPublished}>published</span>
							)}
						</button>
						<Collapsible open={expandedFindingIds.has(finding.id)}>
							<div className={styles.rowExpanded}>
								<FindingBalloon
									finding={finding}
									onCollapse={() => onCollapse(finding.id)}
									actions={actions}
								/>
							</div>
						</Collapsible>
					</li>
				))}
			</ul>
		</section>
	);
}
