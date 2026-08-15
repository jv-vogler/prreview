import { z } from "zod";
import type { BlobRef } from "../../domain/changeset/BlobRef";
import type { ChangesetRef } from "../../domain/changeset/ChangesetRef";
import type { ChangesetSource } from "../../domain/changeset/ChangesetSource";
import type { DiffLine } from "../../domain/changeset/DiffLine";
import type { FileDiff } from "../../domain/changeset/FileDiff";
import type { Hunk } from "../../domain/changeset/Hunk";
import type { HunkCoverage } from "../../domain/coverage/HunkCoverage";
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
	ticket: z.object({ key: z.string(), source: z.string() }).optional(),
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
