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
import type { ReviewPass } from "../../domain/pass/ReviewPass";
import { reviewOutputSchema } from "../../domain/pass/ReviewPass";
import type { ReusePlan } from "../../domain/pass/reusePlan";
import { checkpointOf, planReuse } from "../../domain/pass/reusePlan";
import type {
	FindingEdit,
	PublishedRecord,
	StoredReview,
} from "../../domain/pass/StoredReview";
import { diffStatusResidue } from "../../domain/run/diffStatusResidue";
import type { RunProgressUpdate } from "../../domain/run/RunProgress";
import type { Engine } from "../ports/Engine";
import type { Git } from "../ports/Git";
import type { GithubService } from "../ports/GithubService";
import type { RunContext, RunOutcome } from "../ports/RunManager";
import type { SessionStore } from "../ports/SessionStore";
import { runEngineTask } from "./runEngineTask";

export interface RunReviewInput {
	changesetId: ChangesetId;
	announce: string;
	files: readonly FileDiff[];
	baseSha: string;
	headSha: string | null;
	source: ChangesetSource;
	full: boolean;
}

export interface RunReviewDeps {
	engine: Engine;
	git: Git;
	sessionStore: SessionStore;
	githubService: GithubService | null;

	report: (runId: string, update: RunProgressUpdate) => void;

	logWarning?: (message: string) => void;
}

export function buildReviewJob(
	deps: RunReviewDeps,
	input: RunReviewInput,
): (context: RunContext) => Promise<RunOutcome> {
	const jsonSchema = toJsonSchema(reviewOutputSchema);
	assertSchemaFitsArgv(jsonSchema);

	const task = {
		jsonSchema,
		maxTurns: REVIEW_MAX_TURNS,
		idleTimeoutMs: REVIEW_IDLE_TIMEOUT_MS,
		systemContract: reviewContract(),
		outputSchema: reviewOutputSchema,
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
		const result = await runEngineTask(
			deps,
			context,
			task,
			{ prompt, workspaceDir: await deps.git.repoRoot() },
			{
				noResult: "The review ended with no result.",
				failed: "The review run failed.",
			},
		);
		if (!result.ok) {
			return result.outcome;
		}

		const after = await deps.git.statusPorcelain();
		const answered = reviewOutputSchema.parse(result.structuredOutput);
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
	};
}

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

		findingEdits: {},

		published: withFindingIds(stored?.published ?? null, []),
	};
}

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

			explanations: [
				...stored.pass.explanations.filter((explanation) =>
					unchanged.has(explanation.path),
				),
				...answered.explanations,
			],
		},
		findingIds,
		nextFindingId: firstId + answered.findings.length,

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
