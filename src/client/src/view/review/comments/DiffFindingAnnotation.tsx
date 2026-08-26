import type { ReviewFindingDto } from "@dto/ReviewDto";
import {
	AlertFillIcon,
	CommentIcon,
	QuestionIcon,
} from "@primer/octicons-react";
import { useState } from "react";
import { allQuestions } from "../../../domain/finding/countByTier";
import { worstTier } from "../../../domain/finding/reviewTier";
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
					data-kind={allQuestions(collapsed) ? "question" : undefined}
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

function MarkerIcon({ findings }: { findings: readonly ReviewFindingDto[] }) {
	if (findings.length > 1) {
		return <AlertFillIcon size={14} />;
	}
	if (findings[0]?.kind === "question") {
		return <QuestionIcon size={14} />;
	}
	return <CommentIcon size={14} />;
}

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
