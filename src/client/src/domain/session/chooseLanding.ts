import type { SessionDto } from "@dto/SessionDto";

/** where `/` sends the reader */
export type Landing = "orient" | "diff";

const NOTHING_SEEN_YET = 0;

/**
 * ARCHITECTURE §9's gate rule: a reader who has not looked at anything yet and
 * for whom an intent map already exists should read the orientation first
 * (PRODUCT §6, "read this before any diff"). Everyone else — no map, or a
 * review already under way — goes straight back to the diff, because
 * interrupting a session in progress with an overview would be a regression.
 */
export function chooseLanding(session: SessionDto): Landing {
	const orientIsWorthReading =
		session.analysis.intentMapAvailable &&
		session.coverage.total === NOTHING_SEEN_YET;
	return orientIsWorthReading ? "orient" : "diff";
}
