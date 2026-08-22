import type { ChangesetId } from "../../domain/changeset/ChangesetId";
import type { FileDiff } from "../../domain/changeset/FileDiff";
import { diffStatusResidue } from "../../domain/review/diffStatusResidue";
import { describeToolActivity } from "../../domain/review/RunProgress";
import type { Engine, EngineResultEvent } from "../ports/Engine";
import type { Git } from "../ports/Git";
import type { RunContext, RunOutcome } from "../ports/RunManager";
import type { SessionStore } from "../ports/SessionStore";
import { REVIEW_IDLE_TIMEOUT_MS, REVIEW_MAX_TURNS } from "./limits";
import { reviewContract } from "./reviewContract";
import { buildReviewPrompt } from "./reviewPrompt";
import { reviewPassSchema } from "./reviewSchema";
import { assertSchemaFitsArgv, toJsonSchema } from "./toJsonSchema";

export interface RunReviewInput {
	changesetId: ChangesetId;
	announce: string;
	files: readonly FileDiff[];
}

export interface RunReviewDeps {
	engine: Engine;
	git: Git;
	sessionStore: SessionStore;
	/** the manager's own report(), captured so the job can call back into it */
	report: (
		runId: string,
		update: { kind: "activity"; activity: string },
	) => void;
}

/**
 * Builds the job the run manager runs: spends one `Engine.runTask` call on
 * the vendored review prompt, reports every tool call as progress, and on
 * success saves the pass to the session store — after checking, per
 * SEC-003/TASK-030, whether the run left anything behind on the tree.
 */
export function buildReviewJob(
	deps: RunReviewDeps,
	input: RunReviewInput,
): (context: RunContext) => Promise<RunOutcome> {
	const jsonSchema = toJsonSchema(reviewPassSchema);
	assertSchemaFitsArgv(jsonSchema);

	const task = {
		jsonSchema,
		maxTurns: REVIEW_MAX_TURNS,
		idleTimeoutMs: REVIEW_IDLE_TIMEOUT_MS,
		systemContract: reviewContract(),
		outputSchema: reviewPassSchema,
	};
	const prompt = buildReviewPrompt({
		announce: input.announce,
		files: input.files,
	});

	return async (context) => {
		const before = await deps.git.statusPorcelain();
		const onAbort = () => {
			void deps.engine.stop();
		};
		// covers both a cancel arriving mid-run and one that raced ahead of it
		context.signal.addEventListener("abort", onAbort);
		if (context.signal.aborted) {
			onAbort();
		}

		try {
			let terminal: EngineResultEvent | null = null;
			for await (const event of deps.engine.runTask(task, {
				prompt,
				workspaceDir: await deps.git.repoRoot(),
			})) {
				if (event.type === "tool") {
					deps.report(context.runId, {
						kind: "activity",
						activity: describeToolActivity(event.name, event.target),
					});
				} else if (event.type === "result") {
					terminal = event;
				}
			}

			if (terminal === null) {
				return {
					ok: false,
					reason: "crashed",
					message: "The review ended with no result.",
				};
			}
			if (!terminal.ok) {
				return {
					ok: false,
					reason: terminal.reason,
					message: terminal.stderrTail || "The review run failed.",
				};
			}

			const after = await deps.git.statusPorcelain();
			await deps.sessionStore.saveReview({
				changesetId: input.changesetId,
				createdAt: new Date().toISOString(),
				pass: reviewPassSchema.parse(terminal.structuredOutput),
				residue: diffStatusResidue(before, after),
			});
			return { ok: true };
		} finally {
			context.signal.removeEventListener("abort", onAbort);
		}
	};
}
