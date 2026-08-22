import { z } from "zod";
import { runDtoSchema } from "./RunDto";

/** the one SSE channel's wire shape: a run lifecycle frame, or a keepalive */
export const serverEventSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("run.queued"), run: runDtoSchema }),
	z.object({ type: z.literal("run.started"), run: runDtoSchema }),
	z.object({ type: z.literal("run.progress"), run: runDtoSchema }),
	z.object({ type: z.literal("run.succeeded"), run: runDtoSchema }),
	z.object({ type: z.literal("run.failed"), run: runDtoSchema }),
	z.object({ type: z.literal("run.cancelled"), run: runDtoSchema }),
	z.object({ type: z.literal("heartbeat") }),
]);

export type ServerEvent = z.infer<typeof serverEventSchema>;
