import type { RoundReadLog } from "../../domain/review/groundingGate";
import type { DiscardedCandidate } from "./adjudicate";

/**
 * `rounds/<roundId>/review.json` — what the findings pass decided, beyond the
 * annotations it produced.
 *
 * It exists because three things the pass computes had nowhere to survive a
 * reload: what adjudication threw away, how many anchors could not be placed,
 * and what the round's lenses actually read. All three were computed correctly
 * and dropped, which is this project's recurring bug rather than a new one.
 *
 * The read log is the load-bearing part. It is the evidence a later reword is
 * re-grounded against, so a rewrite cannot come back more verified than the
 * claim it replaced.
 */
export interface RoundReview {
	/** what was thrown away and why — surfaced, never silently dropped */
	discarded: DiscardedCandidate[];
	/** findings whose anchor named nothing placeable in this diff */
	skippedAnchors: number;
	/**
	 * The union of the **lens** children's logs, already repo-relative.
	 *
	 * The comprehension pass's log is deliberately not folded in: lenses fork
	 * that session, so each child's log holds only what it opened, and this is
	 * exactly the set adjudication checked its citations against. Widening it
	 * later would silently upgrade findings that were marked as unverified.
	 */
	readLog: RoundReadLog;
	runId: string;
	producedAt: string;
}
