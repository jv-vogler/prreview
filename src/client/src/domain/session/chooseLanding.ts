import type { SessionDto } from "@dto/SessionDto";

/** where `/` sends the reader */
export type Landing = "understand" | "diff";

const NOTHING_SEEN_YET = 0;

/**
 * Orientation-first (PRODUCT §6: read this before any diff), but never at the
 * cost of interrupting work already under way.
 *
 * A reader who has looked at nothing yet and for whom a comprehension pass has
 * already run should start on Understanding — that is what it is for. Everyone
 * else lands on the diff: with no pass, Understanding has nothing to say, and
 * mid-review an orientation is an interruption.
 */
export function chooseLanding(session: SessionDto): Landing {
	/*
	 * Optional chaining on fields the DTO marks required, deliberately.
	 *
	 * The response boundary logs schema drift and lets the payload through
	 * rather than blocking on it (CON-004, `parseLogged`), so a server older
	 * than the client returns a `SessionDto` that is missing whatever it predates
	 * — and this is the first thing rendered on the first render, which makes it
	 * where that payload lands. Dereferencing straight through turned "drift is a
	 * console error, never a blank screen" into a blank screen, thrown by the one
	 * route whose entire job is deciding whether anything renders at all.
	 *
	 * Absent is not the same as false anywhere else, but here it is: both answers
	 * are "do not send them to Understanding", and the diff is the floor that
	 * stands on its own (PRODUCT §7 F12).
	 */
	const understandingIsWorthReading =
		session.analysis?.understandingAvailable === true &&
		session.coverage?.total === NOTHING_SEEN_YET;
	return understandingIsWorthReading ? "understand" : "diff";
}
