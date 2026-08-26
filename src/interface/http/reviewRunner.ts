import type { PublishEvent } from "../../application/ports/EventPublisher";
import type { RunManager } from "../../application/ports/RunManager";
import { assessPassFreshness } from "../../application/review/passFreshness";
import { buildReworkJob } from "../../application/review/reworkFinding";
import { buildReviewJob } from "../../application/review/runReview";
import type { Container } from "../../container";
import {
	REVIEW_IDLE_TIMEOUT_MS,
	REWORK_IDLE_TIMEOUT_MS,
} from "../../domain/agentTask/limits";
import type { ReworkInstruction } from "../../domain/agentTask/reworkPrompt";
import { changesetIdFor } from "../../domain/changeset/ChangesetId";
import { createRunManager } from "../../infrastructure/engine/runManager";
import type { PassFreshnessDto, ReviewPassDto } from "./dto/ReviewDto";
import type { ReviewStatusDto, RunDto } from "./dto/RunDto";
import type { ReviewState } from "./reviewState";
import { toReviewPassDto } from "./toReviewPassDto";
import { toRunDto } from "./toRunDto";

export interface StartReviewOptions {
	full?: boolean;
}

export interface ReviewRunner {
	start(options?: StartReviewOptions): StartReviewResult;

	startRework(
		findingId: string,
		instruction: ReworkInstruction,
	): StartReviewResult;

	cancelCurrent(): boolean;
	current(): RunDto | null;
	currentPass(): Promise<CurrentPass | null>;
}

export interface CurrentPass {
	pass: ReviewPassDto;
	freshness: PassFreshnessDto;
}

export type StartReviewResult =
	| { kind: "started"; runId: string }
	| { kind: "conflict"; existingRunId: string }
	| { kind: "agent-missing" };

export function createReviewRunner(
	container: Container,
	state: ReviewState,
	publish: PublishEvent,
): ReviewRunner {
	const runManager: RunManager = createRunManager({ publish });

	return {
		start(options) {
			if (container.engine === null) {
				return { kind: "agent-missing" };
			}
			const changeset = state.current();
			const job = buildReviewJob(
				{
					engine: container.engine,
					git: container.git,
					sessionStore: container.sessionStore,
					githubService: container.githubService,
					report: runManager.report,
				},
				{
					changesetId: changesetIdFor(changeset.ref.source),
					announce: changeset.announce.resolved,
					files: changeset.files,
					baseSha: changeset.ref.baseSha,
					headSha: changeset.ref.headSha,
					source: changeset.ref.source,
					full: options?.full === true,
				},
			);
			const result = runManager.start(job, REVIEW_IDLE_TIMEOUT_MS, {
				kind: "review",
			});
			return result.kind === "started"
				? { kind: "started", runId: result.runId }
				: { kind: "conflict", existingRunId: result.existingRunId };
		},

		startRework(findingId, instruction) {
			if (container.engine === null) {
				return { kind: "agent-missing" };
			}
			const changeset = state.current();
			const job = buildReworkJob(
				{
					engine: container.engine,
					git: container.git,
					sessionStore: container.sessionStore,
					report: runManager.report,
				},
				{
					changesetId: changesetIdFor(changeset.ref.source),
					findingId,
					instruction,
					files: changeset.files,
				},
			);
			const result = runManager.start(job, REWORK_IDLE_TIMEOUT_MS, {
				kind: "rework",
				findingId,
			});
			return result.kind === "started"
				? { kind: "started", runId: result.runId }
				: { kind: "conflict", existingRunId: result.existingRunId };
		},

		cancelCurrent() {
			const run = runManager.current();
			return run === null ? false : runManager.cancel(run.id);
		},

		current() {
			const run = runManager.current();
			return run === null ? null : toRunDto(run);
		},

		async currentPass() {
			const changeset = state.current();
			const changesetId = changesetIdFor(changeset.ref.source);
			const stored = await container.sessionStore.loadReview(changesetId);
			if (stored === null) {
				return null;
			}
			return {
				pass: toReviewPassDto(stored, changeset.files),
				freshness: await assessPassFreshness(
					{ git: container.git },
					stored.headSha,
					changeset.ref.headSha,
				),
			};
		},
	};
}

export async function reviewStatusOf(
	runner: ReviewRunner,
): Promise<ReviewStatusDto> {
	const current = await runner.currentPass();
	return {
		run: runner.current(),
		pass: current?.pass ?? null,
		freshness: current?.freshness ?? null,
	};
}
