import { z } from "zod";
import { changesetSourceDtoSchema } from "./ChangesetDto";
import { coverageSummaryDtoSchema } from "./CoverageSummaryDto";

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
 * `GET /api/session` (ARCHITECTURE §8): descriptor, toolchain, coverage
 * summary, and the boot announce. The client never re-derives any of it.
 */
export const sessionDtoSchema = z.object({
	changesetId: z.string(),
	source: changesetSourceDtoSchema,
	roundId: z.string(),
	resumed: z.boolean(),
	toolchain: toolchainDtoSchema,
	announce: announceDtoSchema,
	coverage: coverageSummaryDtoSchema,
});

export type SessionDto = z.infer<typeof sessionDtoSchema>;
