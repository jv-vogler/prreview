import type { RunDto } from "@dto/RunDto";
import { AlertIcon, StopIcon, XIcon } from "@primer/octicons-react";
import { useAnalysis } from "./AnalysisProvider";
import { ANALYSIS_FAILURE_COPY } from "./analysisFailureCopy";
import { formatElapsed } from "./formatElapsed";
import styles from "./RunStatusBar.module.css";
import { useElapsedSince } from "./useElapsedSince";

/**
 * What the running pass is doing, and what went wrong when it did not run.
 *
 * This lives in the layout rather than in a tab because a run belongs to the
 * session, not to the screen that started it: switching tabs must not lose
 * sight of it, and — the reason this exists at all — a run that fails while the
 * reader is on the Diff tab has to reach them there. It also refuses to be a
 * bare spinner. "Running…" with nothing behind it is indistinguishable from a
 * hang, and the tool already knows the difference.
 */

/** how long without a move before the bar stops saying everything is fine */
const STALL_MS = 90_000;

export function RunStatusBar() {
	const analysis = useAnalysis();

	if (analysis.activeRun !== null) {
		return <ActiveRun run={analysis.activeRun} />;
	}
	if (analysis.failure !== null) {
		return <FailedRun />;
	}
	return null;
}

const STAGE_LABEL: Record<string, string> = {
	comprehension: "Reading the change",
	review: "Reviewing for problems",
	chat: "Answering",
};

function ActiveRun({ run }: { run: RunDto }) {
	const analysis = useAnalysis();
	const elapsedMs = useElapsedSince(run.startedAt ?? run.queuedAt);
	const sinceActivityMs = useElapsedSince(run.progress?.lastActivityAt ?? null);
	const stalled = sinceActivityMs !== null && sinceActivityMs > STALL_MS;

	const label = STAGE_LABEL[run.stage] ?? run.stage;

	return (
		<div className={styles.bar} data-run-status="running" role="status">
			<span className={styles.pulse} data-stalled={stalled || undefined} />
			<div className={styles.text}>
				<p className={styles.headline}>
					<span className={styles.stage}>
						{run.status === "queued" ? `${label} (queued)` : label}
					</span>
					{/*
						Elapsed, and nothing it is counting towards. It used to read
						"3m of 10m", which was true of a wall-clock budget and would be a
						lie now: a run that keeps working is not on a countdown. The only
						deadline left is silence, and that is named in the line below
						once there is any silence to name.
					*/}
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
			<button
				type="button"
				className={styles.stop}
				onClick={() => analysis.cancelRun(run.id)}
			>
				<StopIcon size={14} />
				Stop
			</button>
		</div>
	);
}

/**
 * The one line that has to be honest.
 *
 * A run with no reported activity yet is starting up, and says so. A run that
 * has gone quiet past the stall threshold says *that*, rather than continuing
 * to report the last thing it did as though it were still doing it — the
 * difference between "reading a file" and "has been reading a file for four
 * minutes" is the whole question the reader is asking.
 */
function describe(
	run: RunDto,
	stalled: boolean,
	sinceActivityMs: number | null,
): string {
	const progress = run.progress;
	if (run.status === "queued") {
		return "Waiting for the other run on this lane to finish.";
	}
	if (progress === undefined || progress.activity === null) {
		return "Starting the agent and sending it the change…";
	}

	const counted = `${progress.toolCalls} step${progress.toolCalls === 1 ? "" : "s"} so far`;
	const lenses =
		progress.partsTotal === undefined
			? ""
			: ` · ${progress.partsDone ?? 0}/${progress.partsTotal} readings done`;

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
	return `${progress.activity} · ${counted}${lenses}`;
}

/**
 * A failed run, said out loud wherever the reader happens to be.
 *
 * The previous build reported failures only inside the invitation on the tab
 * that started the pass, so a failure was invisible from anywhere else and the
 * screen simply stopped changing. A tool that cannot be used has to say so
 * without being asked.
 */
function FailedRun() {
	const analysis = useAnalysis();
	const failure = analysis.failure;
	if (failure === null) {
		return null;
	}

	return (
		<div className={styles.bar} data-run-status="failed" role="alert">
			<span className={styles.failIcon}>
				<AlertIcon size={16} />
			</span>
			<div className={styles.text}>
				<p className={styles.headline}>
					<span className={styles.stage}>
						{STAGE_LABEL[failure.stage] ?? failure.stage} failed
					</span>
				</p>
				<p className={styles.detail}>{ANALYSIS_FAILURE_COPY[failure.reason]}</p>
				<p className={styles.raw}>{failure.message}</p>
			</div>
			<button
				type="button"
				className={styles.retry}
				onClick={() => analysis.retry(failure.stage)}
			>
				Try again
			</button>
			<button
				type="button"
				className={styles.dismiss}
				onClick={() => analysis.dismissFailure()}
				aria-label="Dismiss this failure"
			>
				<XIcon size={14} />
			</button>
		</div>
	);
}
