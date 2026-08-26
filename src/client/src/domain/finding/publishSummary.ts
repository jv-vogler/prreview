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
