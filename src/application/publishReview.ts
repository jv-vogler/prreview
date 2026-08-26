import type { ChangesetId } from "../domain/changeset/ChangesetId";
import type { ChangesetSource } from "../domain/changeset/ChangesetSource";
import type { FileDiff } from "../domain/changeset/FileDiff";
import { FindingError } from "../domain/errors/FindingError";
import { PublishError } from "../domain/errors/PublishError";
import type { EffectiveFinding } from "../domain/finding/effectiveFindings";
import { effectiveFindings } from "../domain/finding/effectiveFindings";
import type { GithubComment } from "../domain/githubReview/GithubReview";
import type { StoredReview } from "../domain/pass/StoredReview";
import type { GithubService } from "./ports/GithubService";
import type { SessionStore } from "./ports/SessionStore";

export interface PublishReviewDeps {
	githubService: GithubService | null;
	sessionStore: SessionStore;
}

export type PublishExclusionReason = "pre-existing" | "unplaceable";

export interface PublishExclusion {
	id: string;
	reason: PublishExclusionReason;
}

export async function publishReview(
	deps: PublishReviewDeps,
	changesetId: ChangesetId,
	source: ChangesetSource,
	files: readonly FileDiff[],
): Promise<StoredReview> {
	if (deps.githubService === null) {
		throw new PublishError(
			"no-github",
			"No GitHub backend is available; there is nothing to publish to.",
		);
	}
	if (source.kind !== "pr") {
		throw new PublishError(
			"not-a-pull-request",
			"This changeset is not a pull request; there is nothing to publish a review to.",
		);
	}

	const stored = await deps.sessionStore.loadReview(changesetId);
	if (stored === null) {
		throw new FindingError(
			"no-review",
			"No review pass exists for this changeset yet.",
		);
	}

	const { included } = buildPublishPayload(
		effectiveFindings(stored, files).filter((finding) => !finding.deleted),
	);
	if (included.length === 0) {
		throw new PublishError(
			"nothing-publishable",
			"Every comment in this pass was excluded; there is nothing to publish.",
		);
	}

	await discardStalePendingReview(deps.githubService, source.number, stored);

	const review = await deps.githubService.createPendingReview(source.number, {
		findings: included.map((finding) => finding.wire),
	});

	const updated: StoredReview = {
		...stored,
		published: {
			reviewId: review.id,
			htmlUrl: review.htmlUrl,
			publishedAt: new Date().toISOString(),
			findingIds: included.map((finding) => finding.id),
		},
	};
	await deps.sessionStore.saveReview(updated);
	return updated;
}

async function discardStalePendingReview(
	githubService: GithubService,
	pr: number,
	stored: StoredReview,
): Promise<void> {
	if (stored.published === null) {
		return;
	}
	try {
		await githubService.deletePendingReview(pr, stored.published.reviewId);
	} catch {}
}

export function buildPublishPayload(findings: readonly EffectiveFinding[]): {
	included: { id: string; wire: GithubComment }[];
	excluded: PublishExclusion[];
} {
	const included: { id: string; wire: GithubComment }[] = [];
	const excluded: PublishExclusion[] = [];
	for (const finding of findings) {
		const classified = classify(finding);
		if (classified.kind === "included") {
			included.push({ id: finding.id, wire: classified.wire });
		} else {
			excluded.push({ id: finding.id, reason: classified.reason });
		}
	}
	return { included, excluded };
}

function classify(
	finding: EffectiveFinding,
):
	| { kind: "included"; wire: GithubComment }
	| { kind: "excluded"; reason: PublishExclusionReason } {
	if (finding.lane === "pre-existing") {
		return { kind: "excluded", reason: "pre-existing" };
	}
	if (finding.placement.kind === "unplaceable") {
		return { kind: "excluded", reason: "unplaceable" };
	}
	const side = finding.placement.side === "old" ? "LEFT" : "RIGHT";

	const isRange =
		finding.placement.kind === "exact" && finding.startLine !== finding.endLine;
	return {
		kind: "included",
		wire: {
			path: finding.path,
			line: finding.placement.line,
			side,
			body: pasteableBody(finding),
			...(isRange ? { startLine: finding.startLine, startSide: side } : {}),
		},
	};
}

function pasteableBody(finding: EffectiveFinding): string {
	return finding.evidence === undefined
		? finding.body
		: `${finding.body}\n\n${finding.evidence}`;
}
