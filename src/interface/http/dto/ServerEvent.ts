import { z } from "zod";
import { annotationDtoSchema } from "./AnnotationDto";
import { chatMessageDtoSchema } from "./ChatMessageDto";
import { coverageUpdateDtoSchema } from "./CoveragePut";
import { coverageSummaryDtoSchema } from "./CoverageSummaryDto";
import { runDtoSchema, runFailureReasonDtoSchema } from "./RunDto";

/**
 * THE single SSE channel's events (ARCHITECTURE §8). `coverage.updated` carries
 * both the applied updates (other tabs patch per-hunk state) and the fresh
 * summary; `changeset.drifted` deliberately carries nothing — it only raises
 * the banner, and refreshing is a user action.
 *
 * The M2 additions are the live half of the milestone: a run's whole lifecycle,
 * every explanation as it is anchored, and a chat reply arriving token by
 * token. Curation events (`curation.updated`) belong to M3.
 */
export const serverEventSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("heartbeat") }),
	z.object({
		type: z.literal("coverage.updated"),
		updates: z.array(coverageUpdateDtoSchema),
		summary: coverageSummaryDtoSchema,
	}),
	z.object({ type: z.literal("changeset.drifted") }),
	z.object({ type: z.literal("run.queued"), run: runDtoSchema }),
	z.object({ type: z.literal("run.started"), run: runDtoSchema }),
	/**
	 * The run is still going and here is what it is doing. Coalesced by the run
	 * manager to roughly two a second, and never published after a terminal
	 * frame for the same run.
	 */
	z.object({ type: z.literal("run.progress"), run: runDtoSchema }),
	z.object({ type: z.literal("run.succeeded"), run: runDtoSchema }),
	z.object({ type: z.literal("run.failed"), run: runDtoSchema }),
	z.object({ type: z.literal("run.cancelled"), run: runDtoSchema }),
	z.object({
		type: z.literal("annotation.upserted"),
		annotation: annotationDtoSchema,
	}),
	z.object({ type: z.literal("annotation.removed"), id: z.string() }),
	/**
	 * The comprehension pass landed. Carries only the round id: the artifact is
	 * large and the client refetches it, rather than the server pushing a
	 * payload most clients are not looking at.
	 */
	z.object({
		type: z.literal("understanding.updated"),
		roundId: z.string(),
	}),
	/** a findings pass landed, same reasoning */
	z.object({ type: z.literal("findings.updated"), roundId: z.string() }),
	z.object({ type: z.literal("chat.turn.started"), turnId: z.string() }),
	z.object({
		type: z.literal("chat.turn.delta"),
		turnId: z.string(),
		text: z.string(),
	}),
	z.object({
		type: z.literal("chat.turn.completed"),
		turnId: z.string(),
		message: chatMessageDtoSchema,
	}),
	z.object({
		type: z.literal("chat.turn.failed"),
		turnId: z.string(),
		reason: runFailureReasonDtoSchema,
		message: z.string(),
	}),
]);

export type ServerEvent = z.infer<typeof serverEventSchema>;
