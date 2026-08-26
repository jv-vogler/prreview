import type { ChangesetId } from "../domain/changeset/ChangesetId";
import type { ChangesetSource } from "../domain/changeset/ChangesetSource";
import type { FileDiff } from "../domain/changeset/FileDiff";
import { FindingError } from "../domain/errors/FindingError";
import { PublishError } from "../domain/errors/PublishError";
import type { EffectiveFinding } from "../domain/finding/effectiveFindings";
import { effectiveFindings } from "../domain/finding/effectiveFindings";
import type { StoredReview } from "../domain/pass/StoredReview";
import type { GithubComment, GithubService } from "./ports/GithubService";
import type { SessionStore } from "./ports/SessionStore";

export interface PublishReviewDeps {
	/** null = no GitHub backend at all (REQ-009's treatment, mirrored for publish) */
	githubService: GithubService | null;
	sessionStore: SessionStore;
}

export type PublishExclusionReason = "pre-existing" | "unplaceable";

export interface PublishExclusion {
	id: string;
	reason: PublishExclusionReason;
}

/**
 * Publishes the current artifact as a pending GitHub review (GOAL-007,
 * REQ-007, TASK-050): only `review`-lane, placeable comments are sent —
 * `event` stays omitted all the way down to `GhCliGithubService` so the
 * review lands PENDING for the reader to submit themselves, never
 * submitted by prreview itself. The local artifact is never cleared
 * (TASK-053): only `published` changes, so a second pass — more edits, then
 * publish again — is always possible.
 */
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

/**
 * GitHub allows at most one pending review per user per pull request
 * (docs/github-review-notes.md, TASK-014) — publishing again after further
 * edits must clear the previous attempt first. Best-effort: the tracked
 * review may already be gone — submitted or deleted by the reader on
 * GitHub directly — and that is never a reason to block a fresh publish.
 */
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
	} catch {
		// already gone — nothing to clean up
	}
}

/**
 * Splits the artifact's comments into what will actually be sent and what
 * is left behind, and why (TASK-050, REQ-010, REQ-011) — pure and exported
 * so both halves are directly testable, ahead of anything touching the
 * network. GitHub validates a review's `comments[]` atomically
 * (docs/github-review-notes.md, TASK-016): one unresolvable comment 422s
 * the whole batch and creates nothing, including the good ones — so nothing
 * unresolvable may ever reach `included`.
 */
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
	// only an `exact` placement ever carries a genuine range (TASK-040);
	// `clamped` anchors a single nearest line, so only `line` is sent
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

/**
 * One comment as GitHub receives it: the alert block and paragraph, then the
 * visual aid under them. `title` and `proof` are the reviewer's own scan and
 * triage aids and are never published.
 */
function pasteableBody(finding: EffectiveFinding): string {
	return finding.evidence === undefined
		? finding.body
		: `${finding.body}\n\n${finding.evidence}`;
}
