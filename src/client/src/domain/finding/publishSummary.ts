import type { ReviewFindingDto } from "@dto/ReviewDto";

export type PublishExclusionReason = "pre-existing" | "unplaceable";

export interface PublishExclusion {
	finding: ReviewFindingDto;
	reason: PublishExclusionReason;
}

export interface PublishSummary {
	publishable: ReviewFindingDto[];
	excluded: PublishExclusion[];
}

/**
 * Mirrors `publishReview`'s own filter (REQ-010, REQ-011) so the "Send
 * review" control can state, before sending, exactly what will go and what
 * will not (TASK-052) — a client guess that drifted from the server's own
 * rule is the failure mode this exists to avoid.
 */
export function summarizePublish(
	findings: readonly ReviewFindingDto[],
): PublishSummary {
	const publishable: ReviewFindingDto[] = [];
	const excluded: PublishExclusion[] = [];
	for (const finding of findings) {
		if (finding.lane === "pre-existing") {
			excluded.push({ finding, reason: "pre-existing" });
		} else if (finding.placement.kind === "unplaceable") {
			excluded.push({ finding, reason: "unplaceable" });
		} else {
			publishable.push(finding);
		}
	}
	return { publishable, excluded };
}
