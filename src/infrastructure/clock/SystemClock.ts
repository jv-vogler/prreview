import type { Clock } from "../../application/ports/Clock";

export class SystemClock implements Clock {
	now(): Date {
		return new Date();
	}
}
