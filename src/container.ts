import type { Clock } from "./application/ports/Clock";
import { SystemClock } from "./infrastructure/clock/SystemClock";

export interface BootConfig {
	/** absolute repo toplevel (`git rev-parse --show-toplevel`) */
	repoRoot: string;
}

/**
 * The test seam: use-case tests swap adapters for fakes here, at the
 * composition root, never by module mocking (CON-013).
 */
export interface ContainerOverrides {
	clock?: Clock;
}

/**
 * The composition root (CON-009): everything is built once at boot and
 * handed down; nothing below this file imports an implementation directly.
 * Near-empty for now — Phase 1 is a walking skeleton with no features.
 */
export function buildContainer(
	_config: BootConfig,
	overrides: ContainerOverrides = {},
): Container {
	const clock: Clock = overrides.clock ?? new SystemClock();

	return { clock };
}

export interface Container {
	clock: Clock;
}
