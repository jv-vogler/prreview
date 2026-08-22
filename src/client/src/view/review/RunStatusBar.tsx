import type { RunDto } from "@dto/RunDto";
import { AlertIcon, StopIcon } from "@primer/octicons-react";
import { formatElapsed } from "./formatElapsed";
import styles from "./RunStatusBar.module.css";
import { REVIEW_FAILURE_COPY } from "./reviewFailureCopy";
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
	if (run.status === "succeeded" && pass !== null && pass.residue.length > 0) {
		return <ResidueWarning files={pass.residue} />;
	}
	return null;
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

	return (
		<div className={styles.bar} data-run-status="running" role="status">
			<span className={styles.pulse} data-stalled={stalled || undefined} />
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
