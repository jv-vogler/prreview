import type { SessionDto } from "@dto/SessionDto";

/** where `/` sends the reader */
export type Landing = "overview" | "diff";

const NOTHING_SEEN_YET = 0;

/**
 * Orientation-first (PRODUCT §6: read this before any diff), but never at the
 * cost of interrupting work already under way.
 *
 * A reader who has looked at nothing yet and for whom a comprehension pass has
 * already run should start on Overview — that is what it is for. Everyone else
 * lands on the diff: with no pass, Overview has nothing to say, and mid-review
 * an overview is an interruption rather than an orientation.
 */
export function chooseLanding(session: SessionDto): Landing {
	const overviewIsWorthReading =
		session.analysis.understandingAvailable &&
		session.coverage.total === NOTHING_SEEN_YET;
	return overviewIsWorthReading ? "overview" : "diff";
}
