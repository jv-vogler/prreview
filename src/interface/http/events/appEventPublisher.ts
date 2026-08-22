import type {
	AppEvent,
	PublishEvent,
} from "../../../application/ports/EventPublisher";
import { toRunDto } from "../toRunDto";
import type { SseHub } from "./sseHub";

/**
 * The bridge between what the application announces and what the browser
 * sees: a run's domain shape becomes its wire DTO, then goes out on the one
 * SSE channel. This is the `publish` handed to `createReviewRunner` — the
 * application layer never imports the hub or a DTO directly.
 */
export function createAppEventPublisher(hub: SseHub): PublishEvent {
	return (event: AppEvent) => {
		hub.publish({ type: event.type, run: toRunDto(event.run) });
	};
}
