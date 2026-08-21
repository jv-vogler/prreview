import { describe, expect, it } from "vitest";
import { buildTestContainer } from "../test/helpers/buildTestContainer";
import type { Clock } from "./application/ports/Clock";
import { SystemClock } from "./infrastructure/clock/SystemClock";

describe("the container shape", () => {
	it("builds the real adapters when nothing is overridden", () => {
		const container = buildTestContainer();
		expect(container.clock).toBeInstanceOf(SystemClock);
	});

	it("uses an injected fake as-is (CON-013)", () => {
		const fixedInstant = new Date("2026-08-21T00:00:00.000Z");
		const fakeClock: Clock = { now: () => fixedInstant };
		const container = buildTestContainer({ clock: fakeClock });
		expect(container.clock.now()).toBe(fixedInstant);
	});
});
