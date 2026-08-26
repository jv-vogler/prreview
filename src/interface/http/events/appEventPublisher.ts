import type {
	AppEvent,
	PublishEvent,
} from "../../../application/ports/EventPublisher";
import { toRunDto } from "../toRunDto";
import type { SseHub } from "./sseHub";

export function createAppEventPublisher(hub: SseHub): PublishEvent {
	return (event: AppEvent) => {
		hub.publish({ type: event.type, run: toRunDto(event.run) });
	};
}
