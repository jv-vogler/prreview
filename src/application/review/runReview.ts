import type { ChangesetId } from "../../domain/changeset/ChangesetId";
import type { ChangesetSource } from "../../domain/changeset/ChangesetSource";
import type { FileDiff } from "../../domain/changeset/FileDiff";
import { diffStatusResidue } from "../../domain/review/diffStatusResidue";
import {
	describeToolActivity,
	type RunProgressUpdate,
} from "../../domain/review/RunProgress";
import { reviewCommentId } from "../../domain/review/reviewCommentId";
import type { Engine, EngineResultEvent } from "../ports/Engine";
import type { Git } from "../ports/Git";
import type { GithubService } from "../ports/GithubService";
import type { RunContext, RunOutcome } from "../ports/RunManager";
import type { SessionStore, StoredReview } from "../ports/SessionStore";
import { effectiveBody, isDeleted } from "./commentEdits";
import { REVIEW_IDLE_TIMEOUT_MS, REVIEW_MAX_TURNS } from "./limits";
import { reviewContract } from "./reviewContract";
import { buildReviewPrompt, type PreviousReviewInput } from "./reviewPrompt";
import { reviewPassSchema } from "./reviewSchema";
import { assertSchemaFitsArgv, toJsonSchema } from "./toJsonSchema";

export interface RunReviewInput {
	changesetId: ChangesetId;
	announce: string;
	files: readonly FileDiff[];
	/** the changeset's head commit; null for worktree */
	headSha: string | null;
	source: ChangesetSource;
}

export interface RunReviewDeps {
	engine: Engine;
	git: Git;
	sessionStore: SessionStore;
	/** null = no GitHub backend; a re-review then runs without the conversation */
	githubService: GithubService | null;
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
	return async (context) => {
		const stored = await deps.sessionStore.loadReview(input.changesetId);
		const prompt = buildReviewPrompt({
			announce: input.announce,
			files: input.files,
			previous:
				stored === null
					? undefined
					: await previousReviewInput(deps, input.source, stored),
		});
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
				published: carriedPublished(stored?.published ?? null),
			});
			return { ok: true };
		} finally {
			context.signal.removeEventListener("abort", onAbort);
		}
	};
}

/**
 * The stored pass, curation applied, as the prompt's prior notes — plus the
 * PR's inline conversation when there is one to read. Conversation reading
 * is best-effort: a re-review must run offline exactly like a first pass.
 */
async function previousReviewInput(
	deps: RunReviewDeps,
	source: ChangesetSource,
	stored: StoredReview,
): Promise<PreviousReviewInput> {
	return {
		createdAt: stored.createdAt,
		overview: stored.pass.overview,
		verdict: stored.pass.verdict,
		comments: stored.pass.findings.map((finding, index) => {
			const edit = stored.commentEdits[reviewCommentId(index)];
			return {
				tier: finding.tier,
				title: finding.title,
				body: effectiveBody(finding, edit),
				path: finding.path,
				startLine: finding.startLine,
				endLine: finding.endLine,
				dismissed: isDeleted(edit),
				edited: edit?.body !== undefined,
			};
		}),
		conversation: await prConversation(deps.githubService, source),
	};
}

async function prConversation(
	githubService: GithubService | null,
	source: ChangesetSource,
): Promise<PreviousReviewInput["conversation"]> {
	if (githubService === null || source.kind !== "pr") {
		return null;
	}
	try {
		const comments = await githubService.listPrReviewComments(source.number);
		return comments.map((comment) => ({
			author: comment.author,
			path: comment.path,
			line: comment.line,
			body: comment.body,
			isReply: comment.inReplyToId !== null,
		}));
	} catch {
		return null;
	}
}

function carriedPublished(
	published: StoredReview["published"],
): StoredReview["published"] {
	return published === null ? null : { ...published, commentIds: [] };
}
