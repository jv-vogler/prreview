import type { ChangesetRef } from "../domain/changeset/ChangesetRef";
import type { ChangesetSource } from "../domain/changeset/ChangesetSource";
import type { Git } from "./ports/Git";
import type { GithubService } from "./ports/GithubService";
import { resolveSourceRef } from "./resolveChangeset";

/** Local git state (ref SHAs + worktree fingerprint) — cheap, ms-fast (ARCHITECTURE §3). */
const GIT_STATE_POLL_MS = 5_000;
/** PR heads live on GitHub; checking them re-asks the backend, so much rarer. */
const PR_HEAD_POLL_MS = 60_000;

export interface DetectDriftDeps {
	git: Git;
	githubService: GithubService | null;
}

export interface DriftPollerOptions {
	/** live view of the session's current round ref — a refresh swaps it */
	getCurrentRef: () => ChangesetRef;
	/** called once per distinct drift with the freshly observed ref */
	onDrift: (observed: ChangesetRef) => void;
	/** edge #4 of CON-003: a throwing tick logs and continues; default console.error */
	logTickFailure?: (error: unknown) => void;
	/** test seam; defaults to 5s for local git state, 60s for PR heads */
	pollIntervalMs?: number;
}

export interface DriftPoller {
	start(): void;
	stop(): void;
	/** one poll cycle, exposed so tests can drive the state machine directly */
	tick(): Promise<void>;
}

/**
 * The F11 poller: every tick re-resolves the session's source through the
 * same resolveSourceRef the boot used and compares the observed SHAs and
 * worktree fingerprint against the current round's ref. Distinct drift fires
 * onDrift exactly once; the same observed state never refires, and an
 * in-sync tick re-arms the notifier so a revert-then-redo is a new drift.
 *
 * Known asymmetry, accepted for M1: the worktree fingerprint includes
 * untracked files (per its spec) while the worktree changeset (`git diff
 * HEAD`) cannot show them — so creating an untracked file raises the banner
 * even though a refresh would change nothing visible. Coverage carries fully
 * across such a refresh, so the noise is harmless.
 */
export function makeDetectDrift(deps: DetectDriftDeps) {
	return (options: DriftPollerOptions): DriftPoller => {
		const logTickFailure =
			options.logTickFailure ??
			((error: unknown) => {
				console.error(
					"prreview: drift check failed; retrying next tick",
					error,
				);
			});

		let timer: NodeJS.Timeout | undefined;
		let lastNotifiedKey: string | null = null;
		let tickInFlight = false;

		const tick = async (): Promise<void> => {
			if (tickInFlight) {
				return;
			}
			tickInFlight = true;
			try {
				const current = options.getCurrentRef();
				const observed = await resolveSourceRef(
					deps,
					current.source,
					current.requestedAs,
				);
				const observedKey = driftKey(observed);
				if (observedKey === driftKey(current)) {
					lastNotifiedKey = null;
					return;
				}
				if (observedKey === lastNotifiedKey) {
					return;
				}
				lastNotifiedKey = observedKey;
				options.onDrift(observed);
			} catch (error) {
				logTickFailure(error);
			} finally {
				tickInFlight = false;
			}
		};

		const intervalMs =
			options.pollIntervalMs ??
			defaultPollInterval(options.getCurrentRef().source);

		return {
			start() {
				if (timer !== undefined) {
					return;
				}
				timer = setInterval(() => {
					void tick();
				}, intervalMs);
				// the poller must never keep a shutting-down process alive
				timer.unref();
			},
			stop() {
				clearInterval(timer);
				timer = undefined;
			},
			tick,
		};
	};
}

function defaultPollInterval(source: ChangesetSource): number {
	return source.kind === "pr" ? PR_HEAD_POLL_MS : GIT_STATE_POLL_MS;
}

/** The parts of a ref that constitute "the code under review changed". */
function driftKey(ref: ChangesetRef): string {
	return `${ref.baseSha}\n${ref.headSha ?? ""}\n${ref.worktreeFingerprint ?? ""}`;
}
