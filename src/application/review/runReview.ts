import type { ChangesetId } from "../../domain/changeset/ChangesetId";
import type { FileDiff } from "../../domain/changeset/FileDiff";
import { diffStatusResidue } from "../../domain/review/diffStatusResidue";
import {
	describeToolActivity,
	type RunProgressUpdate,
} from "../../domain/review/RunProgress";
import type { Engine, EngineResultEvent } from "../ports/Engine";
import type { Git } from "../ports/Git";
import type { RunContext, RunOutcome } from "../ports/RunManager";
import type { SessionStore, StoredReview } from "../ports/SessionStore";
import { REVIEW_IDLE_TIMEOUT_MS, REVIEW_MAX_TURNS } from "./limits";
import { reviewContract } from "./reviewContract";
import { buildReviewPrompt } from "./reviewPrompt";
import { reviewPassSchema } from "./reviewSchema";
import { assertSchemaFitsArgv, toJsonSchema } from "./toJsonSchema";

export interface RunReviewInput {
	changesetId: ChangesetId;
	announce: string;
	files: readonly FileDiff[];
	/** the changeset's head commit; null for worktree */
	headSha: string | null;
}

export interface RunReviewDeps {
	engine: Engine;
	git: Git;
	sessionStore: SessionStore;
	/** the manager's own report(), captured so the job can call back into it */
	report: (runId: string, update: RunProgressUpdate) => void;
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
				} else if (event.type === "plan") {
					deps.report(context.runId, { kind: "itinerary", steps: event.steps });
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
			const previous = await deps.sessionStore.loadReview(input.changesetId);
			await deps.sessionStore.saveReview({
				changesetId: input.changesetId,
				createdAt: new Date().toISOString(),
				headSha: input.headSha,
				pass: reviewPassSchema.parse(terminal.structuredOutput),
				residue: diffStatusResidue(before, after),
				// a fresh pass replaces the curation (ASSUMPTION-003): comment ids
				// are positional, so edits keyed on the old pass cannot apply
				commentEdits: {},
				// but a pending review the old pass left on GitHub is still out
				// there — its id must survive so the next publish replaces it
				// instead of 422ing. commentIds is emptied for the same
				// positional-id reason: nothing in THIS pass has been published.
				published: carriedPublished(previous?.published ?? null),
			});
			return { ok: true };
		} finally {
			context.signal.removeEventListener("abort", onAbort);
		}
	};
}

function carriedPublished(
	published: StoredReview["published"],
): StoredReview["published"] {
	return published === null ? null : { ...published, commentIds: [] };
}
