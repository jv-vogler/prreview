import type { RunEvent } from "../../domain/run/Run";

export type AppEvent = RunEvent;

export type PublishEvent = (event: AppEvent) => void;
