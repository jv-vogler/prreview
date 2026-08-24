import type { ReviewCommentDto } from "@dto/ReviewDto";
import type { RunDto } from "@dto/RunDto";
import { AlertIcon, StopIcon } from "@primer/octicons-react";
import { countByTier } from "../../domain/review/countByTier";
import { formatElapsed } from "./formatElapsed";
import { Itinerary } from "./Itinerary";
import styles from "./RunStatusBar.module.css";
import { REVIEW_FAILURE_COPY } from "./reviewFailureCopy";
import { REVIEW_TIER_LABEL, REVIEW_TIER_ORDER } from "./reviewTier";
import { useElapsedSince } from "./useElapsedSince";
import type { ReviewRunState } from "./useReviewRun";

/**
 * What a review run is doing, and what went wrong when it did not run
 * (TASK-037, REQ-008). It refuses to be a bare spinner: "Running…" with
 * nothing behind it is indistinguishable from a hang, and the server
 * already knows the difference.
 */

/** how long without a move before the bar stops saying everything is fine */
const STALL_MS = 90_000;

export function RunStatusBar({ review }: { review: ReviewRunState }) {
	const { run, pass } = review;
	// a rework's status renders next to the comment it targets instead
	// (TASK-049) — this bar is the full-pass story only
	if (run === null || run.kind !== "review") {
		return null;
	}
	if (run.status === "failed" || run.status === "timed-out") {
		return <FailedRun run={run} onRetry={review.start} />;
	}
	if (run.status === "queued" || run.status === "running") {
		return <ActiveRun run={run} onCancel={review.cancel} />;
	}
	if (run.status === "cancelled") {
		return <CancelledRun run={run} onRetry={review.start} />;
	}
	if (run.status === "succeeded") {
		return (
			<>
				{pass !== null && pass.residue.length > 0 && (
					<ResidueWarning files={pass.residue} />
				)}
				<CompletedRun run={run} comments={pass?.comments ?? []} />
			</>
		);
	}
	return null;
}

/**
 * What the finished run cost, kept on screen after it ends: a review is slow
 * enough that "how long did that take" is a question worth answering without
 * making the reader have watched the clock.
 */
function CompletedRun({
	run,
	comments,
}: {
	run: RunDto;
	comments: readonly ReviewCommentDto[];
}) {
	const durationMs = runDurationMs(run);
	if (durationMs === null) {
		return null;
	}
	return (
		<div className={styles.bar} data-run-status="succeeded" role="status">
			<div className={styles.text}>
				<p className={styles.headline}>
					<span className={styles.stage}>Reviewed</span>
					<span className={styles.clock} data-run-elapsed>
						{formatElapsed(durationMs)}
					</span>
				</p>
				<p className={styles.detail}>{completedTake(run, comments)}</p>
			</div>
		</div>
	);
}

function completedTake(
	run: RunDto,
	comments: readonly ReviewCommentDto[],
): string {
	const parts: string[] = [];
	const steps = run.progress?.toolCalls;
	if (steps !== undefined) {
		parts.push(`${steps} step${steps === 1 ? "" : "s"}`);
	}
	parts.push(findingsTake(comments));
	return parts.join(" · ");
}

/** "4 findings, 1 blocker" — worst tier called out, worst-first per reviewTier.ts */
function findingsTake(comments: readonly ReviewCommentDto[]): string {
	if (comments.length === 0) {
		return "no findings";
	}
	const counts = countByTier(comments);
	const worst = REVIEW_TIER_ORDER.find((tier) => counts[tier] > 0);
	const total = `${comments.length} finding${comments.length === 1 ? "" : "s"}`;
	if (worst === undefined) {
		return total;
	}
	return `${total}, ${counts[worst]} ${REVIEW_TIER_LABEL[worst].toLowerCase()}${counts[worst] === 1 ? "" : "s"}`;
}

/** Both instants come from the server, so this never straddles two clocks. */
function runDurationMs(run: RunDto): number | null {
	if (run.startedAt === undefined || run.endedAt === undefined) {
		return null;
	}
	const started = Date.parse(run.startedAt);
	const ended = Date.parse(run.endedAt);
	if (Number.isNaN(started) || Number.isNaN(ended)) {
		return null;
	}
	return Math.max(0, ended - started);
}

/**
 * SEC-003's honesty measure: the agent may write to the reviewed repo, so
 * prreview cannot promise the run left the tree untouched. This is where it
 * says so, plainly, with the file list — never silently.
 */
function ResidueWarning({ files }: { files: string[] }) {
	return (
		<div className={styles.bar} data-run-status="residue" role="alert">
			<span className={styles.failIcon}>
				<AlertIcon size={16} />
			</span>
			<div className={styles.text}>
				<p className={styles.headline}>
					<span className={styles.stage}>The review left files behind</span>
				</p>
				<p className={styles.detail}>
					The agent had write access and left{" "}
					{files.length === 1 ? "this file" : "these files"} on your tree:
				</p>
				<p className={styles.raw}>{files.join(", ")}</p>
			</div>
		</div>
	);
}

function ActiveRun({ run, onCancel }: { run: RunDto; onCancel(): void }) {
	const elapsedMs = useElapsedSince(run.startedAt ?? run.queuedAt);
	const sinceActivityMs = useElapsedSince(run.progress?.lastActivityAt ?? null);
	const stalled = sinceActivityMs !== null && sinceActivityMs > STALL_MS;
	const itinerary = run.progress?.itinerary ?? null;

	return (
		<div className={styles.bar} data-run-status="running" role="status">
			{/* once a plan exists its active step carries the "alive" signal —
			 * two pulses in one bar would fight each other */}
			{itinerary === null && (
				<span className={styles.pulse} data-stalled={stalled || undefined} />
			)}
			<div className={styles.text}>
				<p className={styles.headline}>
					<span className={styles.stage}>
						{run.status === "queued" ? "Reviewing (queued)" : "Reviewing"}
					</span>
					{elapsedMs !== null && (
						<span className={styles.clock} data-run-elapsed>
							{formatElapsed(elapsedMs)}
						</span>
					)}
				</p>
				{itinerary !== null && (
					<Itinerary steps={itinerary} stalled={stalled} />
				)}
				<p className={styles.detail} data-run-activity>
					{describe(run, stalled, sinceActivityMs)}
				</p>
			</div>
			<button type="button" className={styles.stop} onClick={onCancel}>
				<StopIcon size={14} />
				Stop
			</button>
		</div>
	);
}

/**
 * The one line that has to be honest.
 *
 * A run with no reported activity yet is starting up, and says so. A run
 * that has gone quiet past the stall threshold says *that*, rather than
 * continuing to report the last thing it did as though it were still doing
 * it — the difference between "reading a file" and "has been reading a file
 * for four minutes" is the whole question the reader is asking.
 */
function describe(
	run: RunDto,
	stalled: boolean,
	sinceActivityMs: number | null,
): string {
	const progress = run.progress;
	if (run.status === "queued") {
		return "Waiting for the current review to finish.";
	}
	if (progress === undefined || progress.activity === null) {
		return "Starting the agent and sending it the change…";
	}
	const counted = `${progress.toolCalls} step${progress.toolCalls === 1 ? "" : "s"} so far`;
	if (stalled) {
		const silence =
			sinceActivityMs === null ? "a while" : formatElapsed(sinceActivityMs);
		const remaining = run.idleTimeoutMs - (sinceActivityMs ?? 0);
		const deadline =
			remaining > 0
				? `It is stopped if the silence reaches ${formatElapsed(run.idleTimeoutMs)}.`
				: "It is being stopped now.";
		return `Nothing for ${silence}. Last move: ${progress.activity}. ${deadline} You can stop it yourself instead.`;
	}
	return `${progress.activity} · ${counted}`;
}

function FailedRun({ run, onRetry }: { run: RunDto; onRetry(): void }) {
	if (run.error === undefined) {
		return null;
	}
	return (
		<div className={styles.bar} data-run-status="failed" role="alert">
			<span className={styles.failIcon}>
				<AlertIcon size={16} />
			</span>
			<div className={styles.text}>
				<p className={styles.headline}>
					<span className={styles.stage}>Review failed</span>
				</p>
				<p className={styles.detail}>{REVIEW_FAILURE_COPY[run.error.reason]}</p>
				<p className={styles.raw}>{run.error.message}</p>
			</div>
			<button type="button" className={styles.retry} onClick={onRetry}>
				Try again
			</button>
		</div>
	);
}

/**
 * A run stopped by the reader's own Stop control (TASK-037): without this
 * the bar simply vanishes, which reads as a bug rather than as the outcome
 * of a deliberate click.
 */
function CancelledRun({ run, onRetry }: { run: RunDto; onRetry(): void }) {
	const durationMs = elapsedAtEnd(run);
	return (
		<div className={styles.bar} data-run-status="cancelled" role="status">
			<div className={styles.text}>
				<p className={styles.headline}>
					<span className={styles.stage}>Review stopped</span>
					{durationMs !== null && (
						<span className={styles.clock} data-run-elapsed>
							{formatElapsed(durationMs)}
						</span>
					)}
				</p>
			</div>
			<button type="button" className={styles.retry} onClick={onRetry}>
				Try again
			</button>
		</div>
	);
}

function elapsedAtEnd(run: RunDto): number | null {
	const start = run.startedAt ?? run.queuedAt;
	if (run.endedAt === undefined) {
		return null;
	}
	const started = Date.parse(start);
	const ended = Date.parse(run.endedAt);
	if (Number.isNaN(started) || Number.isNaN(ended)) {
		return null;
	}
	return Math.max(0, ended - started);
}
