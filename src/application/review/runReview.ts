import {
	REVIEW_IDLE_TIMEOUT_MS,
	REVIEW_MAX_TURNS,
} from "../../domain/agentTask/limits";
import { reviewContract } from "../../domain/agentTask/reviewContract";
import type {
	PreviousReviewInput,
	ReusePromptInput,
	UnchangedExplanationInput,
} from "../../domain/agentTask/reviewPrompt";
import { buildReviewPrompt } from "../../domain/agentTask/reviewPrompt";
import {
	assertSchemaFitsArgv,
	toJsonSchema,
} from "../../domain/agentTask/toJsonSchema";
import type { ChangesetId } from "../../domain/changeset/ChangesetId";
import type { ChangesetSource } from "../../domain/changeset/ChangesetSource";
import type { FileDiff } from "../../domain/changeset/FileDiff";
import { effectiveBody, isDeleted } from "../../domain/finding/curation";
import { findingId, findingIdAt } from "../../domain/finding/findingId";
import type { ReusePlan } from "../../domain/pass/reusePlan";
import { checkpointOf, planReuse } from "../../domain/pass/reusePlan";
import type { ReviewPass } from "../../domain/pass/reviewSchema";
import { reviewPassSchema } from "../../domain/pass/reviewSchema";
import type {
	FindingEdit,
	PublishedRecord,
	StoredReview,
} from "../../domain/pass/StoredReview";
import { diffStatusResidue } from "../../domain/run/diffStatusResidue";
import {
	describeToolActivity,
	type RunProgressUpdate,
} from "../../domain/run/RunProgress";
import type { Engine, EngineResultEvent } from "../ports/Engine";
import type { Git } from "../ports/Git";
import type { GithubService } from "../ports/GithubService";
import type { RunContext, RunOutcome } from "../ports/RunManager";
import type { SessionStore } from "../ports/SessionStore";

export interface RunReviewInput {
	changesetId: ChangesetId;
	announce: string;
	files: readonly FileDiff[];
	/** what the change is measured against */
	baseSha: string;
	/** the changeset's head commit; null for worktree */
	headSha: string | null;
	source: ChangesetSource;
	/**
	 * The reader asked for the whole change to be looked at again. Cross-file
	 * invalidation cannot be made sound, so this is the way out of a delta
	 * pass — never a fallback the code takes on its own.
	 */
	full: boolean;
}

export interface RunReviewDeps {
	engine: Engine;
	git: Git;
	sessionStore: SessionStore;
	/** null = no GitHub backend; a re-review then runs without the conversation */
	githubService: GithubService | null;
	/** the manager's own report(), captured so the job can call back into it */
	report: (runId: string, update: RunProgressUpdate) => void;
	/** test seam; defaults to console.warn */
	logWarning?: (message: string) => void;
}

/**
 * Builds the job the run manager runs: spends one `Engine.runTask` call on
 * the vendored review prompt, reports every tool call as progress, and on
 * success saves the pass to the session store — after checking, per
 * SEC-003/TASK-030, whether the run left anything behind on the tree.
 *
 * A re-review over a pass that recorded a checkpoint costs what moved
 * rather than the size of the change: the files whose diffs are identical
 * byte for byte are named instead of rendered, and what the previous pass
 * said about them is merged back in afterwards.
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
		const plan = reusePlanFor(stored, input);
		const prompt = buildReviewPrompt({
			announce: input.announce,
			files: input.files,
			previous:
				stored === null
					? undefined
					: await previousReviewInput(deps, input.source, stored, plan),
			...(plan === null || stored === null
				? {}
				: { reuse: reusePromptInput(plan, stored) }),
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
			const answered = reviewPassSchema.parse(terminal.structuredOutput);
			await deps.sessionStore.saveReview({
				changesetId: input.changesetId,
				createdAt: new Date().toISOString(),
				headSha: input.headSha,
				residue: diffStatusResidue(before, after),
				checkpoint: checkpointOf(
					{ baseSha: input.baseSha, files: input.files },
					input.headSha,
				),
				...(plan === null || stored === null
					? freshArtifact(answered, stored)
					: mergedArtifact(deps, plan, answered, stored)),
			});
			return { ok: true };
		} finally {
			context.signal.removeEventListener("abort", onAbort);
		}
	};
}

/**
 * Null means the full pass: no checkpoint to read the changeset against, the
 * reader asked for everything again, or nothing at all is reusable, where a
 * delta pass and a full one are the same run with extra framing.
 */
function reusePlanFor(
	stored: StoredReview | null,
	input: RunReviewInput,
): ReusePlan | null {
	if (input.full || stored?.checkpoint === undefined) {
		return null;
	}
	const plan = planReuse(
		stored.checkpoint,
		{ baseSha: input.baseSha, files: input.files },
		stored,
	);
	return plan.unchanged.length === 0 ? null : plan;
}

/** What the artifact carries beyond the run's own facts. */
interface ReviewArtifact {
	pass: ReviewPass;
	findingIds: string[];
	nextFindingId: number;
	carriedFindingIds: string[];
	findingEdits: Record<string, FindingEdit>;
	published: PublishedRecord | null;
}

function freshArtifact(
	answered: ReviewPass,
	stored: StoredReview | null,
): ReviewArtifact {
	const firstId = stored?.nextFindingId ?? 0;
	return {
		pass: answered,
		findingIds: mintIds(firstId, answered.findings.length),
		nextFindingId: firstId + answered.findings.length,
		carriedFindingIds: [],
		// a fresh pass replaces the curation (ASSUMPTION-003): every finding
		// here was minted with an id no earlier one carried, so nothing the
		// reader edited or dismissed is about any of them
		findingEdits: {},
		// but a pending review the old pass left on GitHub is still out there
		// — its id must survive so the next publish replaces it instead of
		// 422ing. findingIds is emptied for the same reason as the edits:
		// nothing in THIS pass has been published.
		published: withFindingIds(stored?.published ?? null, []),
	};
}

/**
 * The carried findings the run did not resolve, then the ones it wrote.
 * Ids come across untouched, which is what keeps the reader's edits and the
 * publish record attached to the findings they were always about.
 */
function mergedArtifact(
	deps: RunReviewDeps,
	plan: ReusePlan,
	answered: ReviewPass,
	stored: StoredReview,
): ReviewArtifact {
	const verdicts = new Map(
		(answered.carried ?? []).map((verdict) => [verdict.id, verdict]),
	);
	reportUnknownVerdicts(deps, plan, verdicts);

	const survivors = plan.carried.filter(
		(carried) => verdicts.get(carried.id)?.verdict !== "resolved",
	);
	const firstId = stored.nextFindingId ?? stored.pass.findings.length;
	const findingIds = [
		...survivors.map((carried) => carried.id),
		...mintIds(firstId, answered.findings.length),
	];
	const kept = new Set(findingIds);
	const unchanged = new Set(plan.unchanged.map((file) => file.path));

	return {
		pass: {
			...answered,
			carried: undefined,
			findings: [
				...survivors.map((carried) => carried.finding),
				...answered.findings,
			],
			// the unchanged files are not in the diff this run saw, so their
			// accounts can only come from the pass that did see them
			explanations: [
				...stored.pass.explanations.filter((explanation) =>
					unchanged.has(explanation.path),
				),
				...answered.explanations,
			],
		},
		findingIds,
		nextFindingId: firstId + answered.findings.length,
		// a survivor the run answered nothing about was never looked at, and
		// the reader is told so rather than left to assume it was
		carriedFindingIds: survivors
			.filter((carried) => !verdicts.has(carried.id))
			.map((carried) => carried.id),
		findingEdits: Object.fromEntries(
			Object.entries(stored.findingEdits).filter(([id]) => kept.has(id)),
		),
		published: withFindingIds(
			stored.published,
			(stored.published?.findingIds ?? []).filter((id) => kept.has(id)),
		),
	};
}

function reportUnknownVerdicts(
	deps: RunReviewDeps,
	plan: ReusePlan,
	verdicts: ReadonlyMap<string, unknown>,
): void {
	const carried = new Set(plan.carried.map((entry) => entry.id));
	const unknown = [...verdicts.keys()].filter((id) => !carried.has(id));
	if (unknown.length === 0) {
		return;
	}
	// never a reason to throw the pass away: the findings it wrote are good
	const log = deps.logWarning ?? ((message: string) => console.warn(message));
	log(
		`prreview: ignoring carried verdicts for ${unknown.join(", ")} — no such finding in this pass`,
	);
}

function mintIds(firstId: number, count: number): string[] {
	return Array.from({ length: count }, (_unused, offset) =>
		findingId(firstId + offset),
	);
}

function withFindingIds(
	published: PublishedRecord | null,
	findingIds: string[],
): PublishedRecord | null {
	return published === null ? null : { ...published, findingIds };
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
	plan: ReusePlan | null,
): Promise<PreviousReviewInput> {
	const carriedById = new Map(
		(plan?.carried ?? []).map((carried) => [carried.id, carried]),
	);
	return {
		createdAt: stored.createdAt,
		overview: stored.pass.overview,
		verdict: stored.pass.verdict,
		findings: stored.pass.findings.map((finding, index) => {
			const id = findingIdAt(stored, index);
			const edit = stored.findingEdits[id];
			const carried = carriedById.get(id);
			return {
				id,
				tier: finding.kind === "question" ? "question" : finding.tier,
				title: finding.title,
				body: effectiveBody(finding, edit),
				path: finding.path,
				startLine: finding.startLine,
				endLine: finding.endLine,
				dismissed: isDeleted(edit),
				edited: edit?.body !== undefined,
				...(carried === undefined
					? {}
					: {
							carried: {
								movedDependencies: carried.movedDependencies,
								unrecorded: carried.unrecorded,
							},
						}),
			};
		}),
		conversation: await prConversation(deps.githubService, source),
	};
}

/** The unchanged files, each with what the previous pass already said about it. */
function reusePromptInput(
	plan: ReusePlan,
	stored: StoredReview,
): ReusePromptInput {
	const findingIds = groupByPath(plan.carried, (carried) => [
		carried.finding.path,
		carried.id,
	]);
	const explanations = groupByPath(
		stored.pass.explanations,
		(explanation): [string, UnchangedExplanationInput] => [
			explanation.path,
			{
				...(explanation.topic === undefined
					? {}
					: { topic: explanation.topic }),
				says: explanation.says,
			},
		],
	);
	return {
		baseMoved: plan.baseMoved,
		changedPaths: plan.changed.map((file) => file.path),
		addedPaths: plan.added.map((file) => file.path),
		removedPaths: plan.removed,
		unchanged: plan.unchanged.map((file) => ({
			path: file.path,
			findingIds: findingIds.get(file.path) ?? [],
			explanations: explanations.get(file.path) ?? [],
		})),
		recheckIds: plan.recheck.map((carried) => carried.id),
	};
}

function groupByPath<Item, Value>(
	items: readonly Item[],
	entryOf: (item: Item) => [string, Value],
): Map<string, Value[]> {
	const grouped = new Map<string, Value[]>();
	for (const item of items) {
		const [path, value] = entryOf(item);
		const existing = grouped.get(path);
		if (existing === undefined) {
			grouped.set(path, [value]);
		} else {
			existing.push(value);
		}
	}
	return grouped;
}

async function prConversation(
	githubService: GithubService | null,
	source: ChangesetSource,
): Promise<PreviousReviewInput["conversation"]> {
	if (githubService === null || source.kind !== "pr") {
		return null;
	}
	try {
		const findings = await githubService.listPrReviewComments(source.number);
		return findings.map((finding) => ({
			author: finding.author,
			path: finding.path,
			line: finding.line,
			body: finding.body,
			isReply: finding.inReplyToId !== null,
		}));
	} catch {
		return null;
	}
}
