import { z } from "zod";
import { changesetSourceDtoSchema } from "./ChangesetDto";
import { coverageSummaryDtoSchema } from "./CoverageSummaryDto";
import { walkthroughProgressDtoSchema } from "./WalkthroughDto";

export const toolchainDtoSchema = z.object({
	agent: z.discriminatedUnion("kind", [
		z.object({ kind: z.literal("claude"), version: z.string() }),
		z.object({ kind: z.literal("none") }),
	]),
	github: z.object({ kind: z.enum(["gh", "git-remote", "none"]) }),
});

export type ToolchainDto = z.infer<typeof toolchainDtoSchema>;

export const announceDtoSchema = z.object({
	resolved: z.string(),
	overrideHint: z.string(),
});

/**
 * What this session already knows about the change, so the client's first
 * render can decide where to send the reader (the `/orient` gate of §9) without
 * a second round trip. Counts and flags only — the artifacts themselves come
 * from their own endpoints.
 */
export const sessionAnalysisDtoSchema = z.object({
	intentMapAvailable: z.boolean(),
	walkthroughAvailable: z.boolean(),
	annotationCount: z.int().min(0),
	walkthroughProgress: walkthroughProgressDtoSchema.optional(),
});

export type SessionAnalysisDto = z.infer<typeof sessionAnalysisDtoSchema>;

/**
 * `GET /api/session` (ARCHITECTURE §8): descriptor, toolchain, coverage
 * summary, what analysis has produced, and the boot announce. The client never
 * re-derives any of it.
 */
export const sessionDtoSchema = z.object({
	changesetId: z.string(),
	source: changesetSourceDtoSchema,
	roundId: z.string(),
	resumed: z.boolean(),
	toolchain: toolchainDtoSchema,
	announce: announceDtoSchema,
	coverage: coverageSummaryDtoSchema,
	analysis: sessionAnalysisDtoSchema,
});

export type SessionDto = z.infer<typeof sessionDtoSchema>;
