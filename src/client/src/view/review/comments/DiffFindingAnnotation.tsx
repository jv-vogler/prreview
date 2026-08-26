import type {
	ReviewFindingDto,
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
import styles from "./DiffFindingAnnotation.module.css";
import type { FindingActions } from "./FindingActions";
import { FindingBalloon } from "./FindingBalloon";

export interface DiffFindingAnnotationProps {
	findingIds: readonly string[];
	findingsById: ReadonlyMap<string, ReviewFindingDto>;
	expandedFindingIds: ReadonlySet<string>;
	onToggle(findingId: string): void;
	actions: FindingActions;
}

/**
 * The gutter marker for one rendered diff line (TASK-043, REQ-004):
 * collapsed by default, showing the worst tier present and how many
 * comments anchor here; each comment opens into its own balloon
 * independently, so the reader controls exactly how many are open at once.
 */
export function DiffFindingAnnotation({
	findingIds,
	findingsById,
	expandedFindingIds,
	onToggle,
	actions,
}: DiffFindingAnnotationProps) {
	const findings = findingIds
		.map((id) => findingsById.get(id))
		.filter((finding): finding is ReviewFindingDto => finding !== undefined);
	if (findings.length === 0) {
		return null;
	}
	const collapsed = findings.filter(
		(finding) => !expandedFindingIds.has(finding.id),
	);
	const expanded = findings.filter((finding) =>
		expandedFindingIds.has(finding.id),
	);

	return (
		<div className={styles.annotation}>
			{collapsed.length > 0 && (
				<button
					type="button"
					className={styles.marker}
					data-finding-marker="true"
					data-tier={worstTier(collapsed)}
					data-kind={markerKind(collapsed)}
					onClick={() => {
						for (const finding of collapsed) {
							onToggle(finding.id);
						}
					}}
				>
					<MarkerIcon findings={collapsed} />
					{collapsed.length > 1 && (
						<span className={styles.count}>{collapsed.length}</span>
					)}
				</button>
			)}
			{expanded.map((finding) => (
				<ExpandingBalloon
					key={finding.id}
					finding={finding}
					onCollapse={() => onToggle(finding.id)}
					actions={actions}
				/>
			))}
		</div>
	);
}

/** A lone question shows a question mark; anything else keeps the comment marks. */
function MarkerIcon({ findings }: { findings: readonly ReviewFindingDto[] }) {
	if (findings.length > 1) {
		return <AlertFillIcon size={14} />;
	}
	if (findings[0]?.kind === "question") {
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
	finding,
	onCollapse,
	actions,
}: {
	finding: ReviewFindingDto;
	onCollapse(): void;
	actions: FindingActions;
}) {
	const [closing, setClosing] = useState(false);

	return (
		<Collapsible open={!closing} onClosed={onCollapse}>
			<FindingBalloon
				finding={finding}
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
	findings: readonly ReviewFindingDto[],
): ReviewTierDto | undefined {
	let worst: ReviewTierDto | undefined;
	for (const finding of findings) {
		if (finding.tier === undefined) {
			continue;
		}
		if (
			worst === undefined ||
			TIER_SEVERITY[finding.tier] < TIER_SEVERITY[worst]
		) {
			worst = finding.tier;
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
	findings: readonly ReviewFindingDto[],
): ReviewFindingKindDto | undefined {
	return findings.every((finding) => finding.kind === "question")
		? "question"
		: undefined;
}
