import type { RunEvent } from "../../domain/run/Run";

/**
 * What the run manager pushes out while a review runs. The application
 * layer never knows about SSE: the interface layer maps this onto wire
 * events and pushes them down the one channel.
 *
 * Publishing is fire-and-forget by design — a use-case must not fail
 * because nobody is listening.
 */
export type AppEvent = RunEvent;

export type PublishEvent = (event: AppEvent) => void;
