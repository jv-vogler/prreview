import type { SessionStore } from "../../src/application/ports/SessionStore";
import type { ChangesetId } from "../../src/domain/changeset/ChangesetId";
import type { FileDiff } from "../../src/domain/changeset/FileDiff";
import type { HunkCoverage } from "../../src/domain/coverage/HunkCoverage";
import { StoreError } from "../../src/domain/errors/StoreError";
import type { SessionManifest } from "../../src/domain/session/SessionManifest";

/**
 * The store port over plain Maps: saves land synchronously (no debounce to
 * wait out in tests), locks are a Set, and `failWritesWith` simulates a
 * read-only checkout by making every write reject with the given error.
 */
export class InMemorySessionStore implements SessionStore {
	readonly manifests = new Map<ChangesetId, SessionManifest>();
	readonly rounds = new Map<string, FileDiff[]>();
	readonly coverageRecords = new Map<
		ChangesetId,
		Record<string, HunkCoverage>
	>();
	readonly blobs = new Map<string, Buffer>();
	readonly locks = new Set<ChangesetId>();
	readonly excludedGitCommonDirs: string[] = [];
	/** when set, every write-side method rejects with this error */
	failWritesWith?: unknown;

	async acquireLock(changesetId: ChangesetId): Promise<void> {
		this.throwIfFailing();
		if (this.locks.has(changesetId)) {
			throw new StoreError(
				"locked",
				`Another prreview is already serving ${changesetId}.`,
			);
		}
		this.locks.add(changesetId);
	}

	async releaseLock(changesetId: ChangesetId): Promise<void> {
		this.locks.delete(changesetId);
	}

	async loadSessionManifest(
		changesetId: ChangesetId,
	): Promise<SessionManifest | null> {
		return this.manifests.get(changesetId) ?? null;
	}

	async saveSessionManifest(manifest: SessionManifest): Promise<void> {
		this.throwIfFailing();
		this.manifests.set(manifest.changesetId, manifest);
	}

	async loadRoundChangeset(
		changesetId: ChangesetId,
		roundId: string,
	): Promise<FileDiff[] | null> {
		return this.rounds.get(roundKey(changesetId, roundId)) ?? null;
	}

	async saveRoundChangeset(
		changesetId: ChangesetId,
		roundId: string,
		files: readonly FileDiff[],
	): Promise<void> {
		this.throwIfFailing();
		this.rounds.set(roundKey(changesetId, roundId), [...files]);
	}

	async loadCoverage(
		changesetId: ChangesetId,
	): Promise<Record<string, HunkCoverage>> {
		return this.coverageRecords.get(changesetId) ?? {};
	}

	async saveCoverage(
		changesetId: ChangesetId,
		coverage: Readonly<Record<string, HunkCoverage>>,
	): Promise<void> {
		this.throwIfFailing();
		this.coverageRecords.set(changesetId, { ...coverage });
	}

	async writeBlob(oid: string, content: Buffer): Promise<void> {
		this.throwIfFailing();
		this.blobs.set(oid, content);
	}

	async readBlob(oid: string): Promise<Buffer | null> {
		return this.blobs.get(oid) ?? null;
	}

	async hasBlob(oid: string): Promise<boolean> {
		return this.blobs.has(oid);
	}

	async ensureExcluded(gitCommonDir: string): Promise<void> {
		this.throwIfFailing();
		this.excludedGitCommonDirs.push(gitCommonDir);
	}

	async flush(): Promise<void> {
		// in-memory saves land synchronously; nothing to flush
	}

	private throwIfFailing(): void {
		if (this.failWritesWith !== undefined) {
			throw this.failWritesWith;
		}
	}
}

function roundKey(changesetId: ChangesetId, roundId: string): string {
	return `${changesetId} ${roundId}`;
}
