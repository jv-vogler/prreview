import type { StoredAnnotation } from "../../domain/annotation/Annotation";
import type { ChatMessage } from "../../domain/chat/ChatThread";
import type { EngineErrorReason } from "../../domain/errors/EngineError";
import type { RunEvent } from "./RunManager";

/**
 * What the run manager and the M2 use-cases push out while work happens
 * (ARCHITECTURE §8). The application layer never knows about SSE: the
 * interface layer maps this union onto `ServerEvent` DTOs and pushes them
 * down the single channel.
 *
 * Publishing is fire-and-forget by design — a use-case must not fail because
 * nobody is listening — so the callback returns void and a container with no
 * interface layer attached gets a no-op sink.
 */
export type AppEvent = RunEvent | AnnotationEvent | ChatEvent;

export type PublishEvent = (event: AppEvent) => void;

export type AnnotationEvent =
	| { type: "annotation.upserted"; annotation: StoredAnnotation }
	| { type: "annotation.removed"; id: string };

export type ChatEvent =
	| { type: "chat.turn.started"; turnId: string }
	| { type: "chat.turn.delta"; turnId: string; text: string }
	| { type: "chat.turn.completed"; turnId: string; message: ChatMessage }
	| {
			type: "chat.turn.failed";
			turnId: string;
			reason: EngineErrorReason | "internal";
			message: string;
	  };
