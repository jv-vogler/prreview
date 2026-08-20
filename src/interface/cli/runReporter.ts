import type { AppEvent } from "../../application/ports/EventPublisher";
import type { Run } from "../../application/ports/RunManager";

/**
 * The run, narrated in the terminal prreview was started from.
 *
 * The browser is the primary surface, but it is not the only one a person
 * looks at when they are unsure whether a tool is working — and a terminal
 * showing nothing but the boot banner while a pass runs for eight minutes
 * invites exactly the "is this thing on?" that sent the reader to `curl` in
 * the first place. This is the cheap second witness: same facts, no click.
 */

export interface RunReporterOptions {
	write(line: string): void;
	/** test seam; the reporter is deliberately quiet between ticks */
	tickMs?: number;
	now?(): number;
}

export interface RunReporter {
	/** every AppEvent passes through; only `run.*` produces output */
	observe(event: AppEvent): void;
}

/** one progress line every few seconds: enough to show life, quiet enough to read past */
const DEFAULT_TICK_MS = 5000;

export function createRunReporter(options: RunReporterOptions): RunReporter {
	const tickMs = options.tickMs ?? DEFAULT_TICK_MS;
	const now = options.now ?? Date.now;
	const lastPrintedAt = new Map<string, number>();

	return {
		observe(event) {
			if (!event.type.startsWith("run.")) {
				return;
			}
			const run = "run" in event ? event.run : undefined;
			if (run === undefined || run.lane !== "analysis") {
				// chat turns are answered on screen as they stream; narrating them
				// here would drown the one thing this is for
				return;
			}

			switch (event.type) {
				case "run.started":
					lastPrintedAt.set(run.id, now());
					options.write(
						`prreview: ${run.taskType} run started — runs as long as it keeps working, stops after ${formatDuration(run.idleTimeoutMs)} of silence\n`,
					);
					return;
				case "run.progress": {
					const last = lastPrintedAt.get(run.id) ?? 0;
					if (now() - last < tickMs) {
						return;
					}
					lastPrintedAt.set(run.id, now());
					options.write(`  ${progressLine(run)}\n`);
					return;
				}
				case "run.succeeded":
					lastPrintedAt.delete(run.id);
					options.write(
						`prreview: ${run.taskType} run finished${elapsedSuffix(run)}${lossesSuffix(run)}\n`,
					);
					return;
				case "run.failed":
					lastPrintedAt.delete(run.id);
					options.write(
						`prreview: ${run.taskType} run FAILED${elapsedSuffix(run)} — ${run.error?.message ?? "no reason given"}\n`,
					);
					return;
				case "run.cancelled":
					lastPrintedAt.delete(run.id);
					options.write(`prreview: ${run.taskType} run cancelled\n`);
					return;
				default:
					return;
			}
		},
	};
}

function progressLine(run: Run): string {
	const progress = run.progress;
	const parts: string[] = [];
	if (run.startedAt !== undefined) {
		parts.push(formatDuration(Date.now() - Date.parse(run.startedAt)));
	}
	if (progress !== undefined) {
		parts.push(
			`${progress.toolCalls} tool call${progress.toolCalls === 1 ? "" : "s"}`,
		);
		if (progress.partsTotal !== undefined) {
			parts.push(`${progress.partsDone ?? 0}/${progress.partsTotal} lenses`);
		}
		if (progress.activity !== null) {
			parts.push(progress.activity);
		}
	}
	return parts.join(" · ");
}

function elapsedSuffix(run: Run): string {
	if (run.startedAt === undefined || run.endedAt === undefined) {
		return "";
	}
	return ` in ${formatDuration(Date.parse(run.endedAt) - Date.parse(run.startedAt))}`;
}

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;

export /**
 * What the run computed and threw away, said out loud.
 *
 * A run that quietly discarded four candidates and failed to place one anchor
 * looks identical, in a terminal, to one that found nothing — and the reader has
 * no way to tell "nothing to say" from "everything was cut". Both numbers ride
 * the run itself, so this costs no extra state; runs are ephemeral, which is why
 * the tab keeps its own copy that survives a reload.
 */
function lossesSuffix(run: Run): string {
	const losses: string[] = [];
	const discarded = run.discardedCandidates ?? 0;
	const skipped = run.skippedAnchors ?? 0;
	if (discarded > 0) {
		losses.push(
			`${discarded} ${discarded === 1 ? "candidate" : "candidates"} did not make the cut`,
		);
	}
	if (skipped > 0) {
		losses.push(
			`${skipped} ${skipped === 1 ? "anchor" : "anchors"} could not be placed`,
		);
	}
	return losses.length === 0 ? "" : ` — ${losses.join(", ")}`;
}

function formatDuration(ms: number): string {
	const totalSeconds = Math.max(0, Math.round(ms / MS_PER_SECOND));
	const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
	const seconds = totalSeconds % SECONDS_PER_MINUTE;
	return minutes === 0
		? `${seconds}s`
		: `${minutes}m${String(seconds).padStart(2, "0")}s`;
}
