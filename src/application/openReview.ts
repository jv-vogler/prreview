import {
	type ChangesetId,
	changesetIdFor,
} from "../domain/changeset/ChangesetId";
import type { TicketHint } from "../domain/analysis/discoverTicket";
import type { ChangesetRef } from "../domain/changeset/ChangesetRef";
import type { FileDiff } from "../domain/changeset/FileDiff";
import type { HunkCoverage } from "../domain/coverage/HunkCoverage";
import { ChangesetError } from "../domain/errors/ChangesetError";
import { StoreError } from "../domain/errors/StoreError";
import { SCHEMA_VERSION } from "../domain/session/SCHEMA_VERSION";
import type { SessionManifest } from "../domain/session/SessionManifest";
import type { Toolchain } from "../domain/session/Toolchain";
import type { Git } from "./ports/Git";
import type { GithubService } from "./ports/GithubService";
import type { SessionStore } from "./ports/SessionStore";
import { readChangesetFiles } from "./readChangesetFiles";
import type {
	ChangesetAnnounce,
	ResolveChangeset,
	ResolveChangesetInput,
} from "./resolveChangeset";

const FIRST_ROUND_ID = "r1";

const READ_ONLY_FS_CODES = new Set(["EACCES", "EROFS", "EPERM"]);

export interface OpenReviewDeps {
	resolveChangeset: ResolveChangeset;
	git: Git;
	githubService: GithubService | null;
	store: SessionStore;
	toolchain: Toolchain;
}

/** Everything `/api/session` and the CLI announce need (ARCHITECTURE §3). */
export interface OpenedReview {
	manifest: SessionManifest;
	roundId: string;
	/** the current round's ref — on resume, the stored one (drift detection compares against it) */
	ref: ChangesetRef;
	files: FileDiff[];
	coverage: Record<string, HunkCoverage>;
	resumed: boolean;
	announce: ChangesetAnnounce;
}

export type OpenReview = (
	input: ResolveChangesetInput,
) => Promise<OpenedReview>;

/**
 * The boot use-case: resolve what to review (fetching a PR head if it is not
 * local — inside resolveSourceRef, because the ref's baseSha is a merge-base
 * that needs the head present), parse the diff into the IR, and load or
 * create the session keyed by ChangesetId (ARCHITECTURE §3, §11). Saves are
 * fire-and-forget through the store's debounce; shutdown's flush() covers
 * them.
 */
export function makeOpenReview(deps: OpenReviewDeps): OpenReview {
	return async (input) => {
		const { ref, announce, ticket } = await deps.resolveChangeset(input);
		const changesetId = changesetIdFor(ref.source);

		try {
			await deps.store.acquireLock(changesetId);
			await deps.store.ensureExcluded(await deps.git.gitCommonDir());
		} catch (error) {
			throw convertReadOnlyCheckout(error);
		}

		const existing = await deps.store.loadSessionManifest(changesetId);
		if (existing !== null) {
			return resumeSession(deps, existing, announce, ticket);
		}
		return createSession(deps, changesetId, ref, announce, ticket);
	};
}

/**
 * A checkout where `.prreview/` (or `.git/info/exclude`) cannot be written
 * exits with a clear error in v1 (ARCHITECTURE §3). Anything that is not a
 * permission-shaped fs failure — StoreError('locked') included — propagates
 * untouched.
 */
function convertReadOnlyCheckout(error: unknown): unknown {
	const code = (error as NodeJS.ErrnoException).code;
	if (typeof code === "string" && READ_ONLY_FS_CODES.has(code)) {
		return new ChangesetError(
			"read-only-checkout",
			"This checkout is read-only: prreview needs to create .prreview/ at the repo root and register it in .git/info/exclude.",
			{ cause: error },
		);
	}
	return error;
}

async function resumeSession(
	deps: OpenReviewDeps,
	manifest: SessionManifest,
	announce: ChangesetAnnounce,
	ticket: TicketHint | null,
): Promise<OpenedReview> {
	const roundId = manifest.currentRound;
	const currentRound = manifest.rounds.find((round) => round.id === roundId);
	const files = await deps.store.loadRoundChangeset(
		manifest.changesetId,
		roundId,
	);
	if (currentRound === undefined || files === null) {
		throw new StoreError(
			"corrupt",
			`Session ${manifest.changesetId} names round ${roundId} but its snapshot is missing. Delete .prreview/ to reset the session.`,
		);
	}
	const coverage = await deps.store.loadCoverage(manifest.changesetId);

	// this boot's probe governs the session from here on: a gh that appeared
	// or vanished since the last run must not be reported stale to the UI
	// Same reasoning for the ticket: it is re-discovered every boot from the
	// live branch and PR, so a retitled PR or a renamed branch is picked up
	// rather than frozen at whatever the first run happened to see.
	const updated: SessionManifest = {
		...manifest,
		toolchain: deps.toolchain,
		...(ticket === null ? {} : { ticket }),
	};
	void deps.store.saveSessionManifest(updated);

	return {
		manifest: updated,
		roundId,
		ref: currentRound.ref,
		files,
		coverage,
		resumed: true,
		announce,
	};
}

async function createSession(
	deps: OpenReviewDeps,
	changesetId: ChangesetId,
	ref: ChangesetRef,
	announce: ChangesetAnnounce,
	ticket: TicketHint | null,
): Promise<OpenedReview> {
	const files = await readChangesetFiles(deps, ref);
	const manifest: SessionManifest = {
		schemaVersion: SCHEMA_VERSION,
		changesetId,
		source: ref.source,
		toolchain: deps.toolchain,
		rounds: [{ id: FIRST_ROUND_ID, ref, runs: [] }],
		currentRound: FIRST_ROUND_ID,
		engine: { adapter: deps.toolchain.agent.kind, chatThreads: [] },
		...(ticket === null ? {} : { ticket }),
	};
	void deps.store.saveSessionManifest(manifest);
	void deps.store.saveRoundChangeset(changesetId, FIRST_ROUND_ID, files);

	return {
		manifest,
		roundId: FIRST_ROUND_ID,
		ref,
		files,
		coverage: {},
		resumed: false,
		announce,
	};
}
