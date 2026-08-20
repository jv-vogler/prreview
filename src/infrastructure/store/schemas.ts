import { z } from "zod";
import type { RoundAnalysis } from "../../application/analysis/RoundAnalysis";
import type { ReadLog } from "../../application/ports/Engine";
import type { DiscardReason } from "../../application/review/adjudicate";
import type { RoundReview } from "../../application/review/RoundReview";
import type { Anchor, AnchorStatus } from "../../domain/anchor/Anchor";
import type {
	Citation,
	FindingMark,
	StoredAnnotation,
} from "../../domain/annotation/Annotation";
import type { BlobRef } from "../../domain/changeset/BlobRef";
import type { ChangesetRef } from "../../domain/changeset/ChangesetRef";
import type { ChangesetSource } from "../../domain/changeset/ChangesetSource";
import type { DiffLine } from "../../domain/changeset/DiffLine";
import type { FileDiff } from "../../domain/changeset/FileDiff";
import type { Hunk } from "../../domain/changeset/Hunk";
import type {
	ChatMessage,
	ChatMessageContext,
	ChatThread,
} from "../../domain/chat/ChatThread";
import type { HunkCoverage } from "../../domain/coverage/HunkCoverage";
import type { ReadRange } from "../../domain/review/groundingGate";
import type { RunMeta } from "../../domain/session/RunMeta";
import type { SessionManifest } from "../../domain/session/SessionManifest";
import type { Toolchain } from "../../domain/session/Toolchain";

/**
 * Zod schemas for what SessionStore reads back from disk (CON-004 boundary
 * #4: session files on open; a failed parse is StoreError('corrupt')). These
 * validate storage, not the wire — the dto-folder rule does not apply here.
 * Each schema is pinned to its domain type with a z.ZodType annotation, so
 * schema and domain shape cannot drift without a compile error. Unknown keys
 * are stripped, not rejected: additive optional fields never bump the schema
 * version (ARCHITECTURE §11), so an older binary must tolerate them.
 */

const changesetSourceSchema: z.ZodType<ChangesetSource> = z.discriminatedUnion(
	"kind",
	[
		z.object({ kind: z.literal("pr"), repo: z.string(), number: z.number() }),
		z.object({
			kind: z.literal("branch"),
			branch: z.string(),
			base: z.string(),
		}),
		z.object({ kind: z.literal("range"), from: z.string(), to: z.string() }),
		z.object({ kind: z.literal("worktree") }),
	],
);

const changesetRefSchema: z.ZodType<ChangesetRef> = z.object({
	source: changesetSourceSchema,
	requestedAs: z.string().optional(),
	baseSha: z.string(),
	headSha: z.string().nullable(),
	worktreeFingerprint: z.string().optional(),
	resolvedAt: z.string(),
});

const toolchainSchema: z.ZodType<Toolchain> = z.object({
	agent: z.discriminatedUnion("kind", [
		z.object({ kind: z.literal("claude"), version: z.string() }),
		z.object({ kind: z.literal("none") }),
	]),
	github: z.discriminatedUnion("kind", [
		z.object({ kind: z.literal("gh") }),
		z.object({ kind: z.literal("git-remote") }),
		z.object({ kind: z.literal("none") }),
	]),
});

const runMetaSchema: z.ZodType<RunMeta> = z.object({
	stage: z.string(),
	engineSessionId: z.string(),
	model: z.string(),
	startedAt: z.string(),
	endedAt: z.string(),
	costUsd: z.number().optional(),
	numTurns: z.number().optional(),
	status: z.string(),
	reason: z.string().optional(),
});

export const sessionManifestSchema: z.ZodType<SessionManifest> = z.object({
	schemaVersion: z.number(),
	changesetId: z.string(),
	source: changesetSourceSchema,
	toolchain: toolchainSchema,
	rounds: z.array(
		z.object({
			id: z.string(),
			ref: changesetRefSchema,
			runs: z.array(runMetaSchema),
		}),
	),
	currentRound: z.string(),
	engine: z.object({
		adapter: z.string(),
		analysisSessionId: z.string().optional(),
		chatThreads: z.array(
			z.object({ id: z.string(), engineSessionId: z.string() }),
		),
	}),
	ticket: z
		.object({
			key: z.string(),
			source: z.enum(["branch", "title", "body"]),
			url: z.string().optional(),
		})
		.optional(),
});

const blobRefSchema: z.ZodType<BlobRef> = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("odb"), oid: z.string() }),
	z.object({ kind: z.literal("worktree"), path: z.string(), oid: z.string() }),
	z.object({ kind: z.literal("stored"), oid: z.string() }),
]);

const diffLineSchema: z.ZodType<DiffLine> = z.object({
	type: z.enum(["context", "add", "del"]),
	content: z.string(),
	oldLine: z.number().optional(),
	newLine: z.number().optional(),
	noEol: z.boolean().optional(),
});

const hunkSchema: z.ZodType<Hunk> = z.object({
	id: z.string(),
	header: z.string(),
	oldStart: z.number(),
	oldLines: z.number(),
	newStart: z.number(),
	newLines: z.number(),
	lines: z.array(diffLineSchema),
});

const fileDiffSchema: z.ZodType<FileDiff> = z.object({
	id: z.string(),
	path: z.string(),
	oldPath: z.string().optional(),
	status: z.enum([
		"added",
		"modified",
		"deleted",
		"renamed",
		"copied",
		"type-changed",
	]),
	additions: z.number(),
	deletions: z.number(),
	isBinary: z.boolean(),
	isGenerated: z.boolean(),
	language: z.string().optional(),
	oldBlob: blobRefSchema.nullable(),
	newBlob: blobRefSchema.nullable(),
	hunks: z.array(hunkSchema),
});

/** rounds/rN/changeset.json — the IR snapshot (hunks yes, blob contents no). */
export const roundChangesetSchema: z.ZodType<FileDiff[]> =
	z.array(fileDiffSchema);

/** coverage.json — hunkId → state; absent means unseen. */
export const coverageSchema: z.ZodType<Record<string, HunkCoverage>> = z.record(
	z.string(),
	z.enum(["unseen", "viewed", "reviewed"]),
);

const anchorStatusSchema: z.ZodType<AnchorStatus> = z.enum([
	"anchored",
	"moved",
	"fuzzy",
	"orphaned",
]);

const anchorSchema: z.ZodType<Anchor> = z.object({
	fileId: z.string(),
	path: z.string(),
	side: z.enum(["old", "new"]),
	startLine: z.number(),
	endLine: z.number(),
	placement: z.enum(["in-diff", "in-file", "file-level"]),
	snapshot: z.object({
		blobOid: z.string(),
		targetLines: z.array(z.string()),
		lineHash: z.string(),
		contextBefore: z.array(z.string()),
		contextAfter: z.array(z.string()),
	}),
});

const citationSchema: z.ZodType<Citation> = z.object({
	path: z.string(),
	startLine: z.number().optional(),
	endLine: z.number().optional(),
	note: z.string().optional(),
});

const findingMarkSchema: z.ZodType<FindingMark> = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("ungrounded-citation"), path: z.string() }),
	z.object({ kind: z.literal("inferred-path") }),
]);

const storedAnnotationSchema: z.ZodType<StoredAnnotation> = z.object({
	id: z.string(),
	species: z.enum(["explanation", "finding", "related-finding"]),
	anchor: anchorSchema,
	anchorStatus: anchorStatusSchema,
	body: z.string(),
	provenance: z.object({
		roundId: z.string(),
		stage: z.string(),
		engineSessionId: z.string(),
	}),
	createdAt: z.string(),
	touchedByDelta: z.boolean().optional(),
	title: z.string().optional(),
	originalBody: z.string().optional(),
	category: z.string().optional(),
	severity: z.string().optional(),
	proof: z
		.object({
			mode: z.enum(["traced", "inferred"]),
			how: z.string(),
			stale: z.boolean().optional(),
		})
		.optional(),
	editTrail: z
		.array(
			z.object({
				at: z.string(),
				by: z.enum(["user", "chat"]),
				previousBody: z.string(),
			}),
		)
		.optional(),
	confidence: z.enum(["high", "medium", "low"]).optional(),
	citations: z.array(citationSchema).optional(),
	groundingVerified: z.boolean().optional(),
	marks: z.array(findingMarkSchema).optional(),
	reproTest: z.string().optional(),
	suggestedFix: z.string().optional(),
	curation: z
		.object({
			state: z.enum(["proposed", "accepted", "edited", "dismissed"]),
			dismissReason: z.string().optional(),
			updatedAt: z.string(),
		})
		.optional(),
	resolution: z
		.object({ addressedInRound: z.string(), evidence: z.string() })
		.optional(),
	publish: z
		.object({
			githubThreadId: z.string().optional(),
			publishedAt: z.string().optional(),
			downgradedToFileLevel: z.boolean().optional(),
		})
		.optional(),
});

/** annotations.json — every annotation of the session, all rounds. */
export const annotationsSchema: z.ZodType<StoredAnnotation[]> = z.array(
	storedAnnotationSchema,
);

/**
 * A read entry, tolerating the bare path an older prreview wrote.
 *
 * `reads` used to be `string[]`; it carries the range now, because line-level
 * grounding is impossible without it. That is not an additive change, so a
 * strict schema would refuse every round already on disk — and a bare path is
 * exactly what an absent range means downstream ("the whole file was read"),
 * so the old shape has a faithful reading rather than needing a migration.
 */
const readRangeSchema = z.union([
	z.string().transform((path): ReadRange => ({ path })),
	z.object({
		path: z.string(),
		offset: z.number().optional(),
		limit: z.number().optional(),
	}),
]);

/** input differs from output here (the string branch transforms), so this one
 * schema cannot carry the `z.ZodType<T>` pin the others do */
const readLogSchema = z.object({
	reads: z.array(readRangeSchema),
	searchHits: z.array(z.string()),
}) satisfies z.ZodType<ReadLog, unknown>;

const topicRefSchema = z.object({
	path: z.string(),
	hunkIds: z.array(z.string()),
});

const topicSchema = z.object({
	id: z.string(),
	title: z.string(),
	summary: z.string(),
	kind: z.enum([
		"core",
		"refactor",
		"tests",
		"config",
		"docs",
		"generated",
		"chore",
	]),
	refs: z.array(topicRefSchema),
});

const goalMatchSchema = z.object({
	verdict: z.enum(["matches", "partly", "diverges", "unclear"]),
	rationale: z.string(),
	basis: z.enum(["ticket", "inferred"]),
	ticket: z
		.object({
			key: z.string(),
			source: z.enum(["branch", "title", "body"]),
			url: z.string().optional(),
		})
		.nullable(),
});

const understandingSchema = z.object({
	headline: z.string(),
	summary: z.array(z.string()),
	topics: z.array(topicSchema),
	suggestedEntryPoint: z.string(),
	goalMatch: goalMatchSchema,
	uncoveredHunks: z.array(z.object({ path: z.string(), hunkId: z.string() })),
});

/**
 * rounds/<roundId>/analysis.json — the comprehension pass's output, stored in
 * the built domain shape (ids assigned, basis stamped, omissions derived)
 * rather than as the agent's raw draft, so what a reload serves is exactly what
 * the run served and no derivation has to be repeated or kept in sync.
 */
export const roundAnalysisSchema: z.ZodType<RoundAnalysis> = z.object({
	understanding: understandingSchema,
	readLog: readLogSchema,
	runId: z.string(),
	engineSessionId: z.string(),
});

const discardReasonSchema: z.ZodType<DiscardReason> = z.discriminatedUnion(
	"kind",
	[
		z.object({
			kind: z.literal("below-confidence-floor"),
			confidence: z.number(),
			floor: z.number(),
		}),
		z.object({ kind: z.literal("form"), rules: z.array(z.string()) }),
		z.object({
			kind: z.literal("ungrounded-blocker"),
			path: z.string(),
			why: z.enum(["never-opened", "outside-read-range"]),
		}),
	],
);

/**
 * rounds/<roundId>/review.json — what the findings pass decided beyond the
 * annotations it wrote: the candidates it threw away, the anchors it could not
 * place, and the read log its citations were checked against.
 */
export const roundReviewSchema: z.ZodType<RoundReview, unknown> = z.object({
	discarded: z.array(
		z.object({
			title: z.string(),
			species: z.enum(["finding", "related-finding"]),
			severity: z.string(),
			lenses: z.array(z.string()),
			reason: discardReasonSchema,
		}),
	),
	skippedAnchors: z.number(),
	readLog: readLogSchema,
	runId: z.string(),
	producedAt: z.string(),
});

const chatMessageContextSchema: z.ZodType<ChatMessageContext> = z.object({
	file: z.string().optional(),
	hunkId: z.string().optional(),
	annotationId: z.string().optional(),
});

const chatMessageSchema: z.ZodType<ChatMessage> = z.object({
	role: z.enum(["user", "assistant"]),
	text: z.string(),
	context: chatMessageContextSchema.optional(),
	at: z.string(),
});

/** chat/<threadId>.json — one thread per session in M2. */
export const chatThreadSchema: z.ZodType<ChatThread> = z.object({
	id: z.string(),
	engineSessionId: z.string().optional(),
	messages: z.array(chatMessageSchema),
});
