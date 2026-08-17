import type { WalkthroughProgress } from "../../domain/analysis/Walkthrough";
import type { StoredAnnotation } from "../../domain/annotation/Annotation";
import type { ChangesetId } from "../../domain/changeset/ChangesetId";
import type { FileDiff } from "../../domain/changeset/FileDiff";
import type { ChatThread } from "../../domain/chat/ChatThread";
import type { HunkCoverage } from "../../domain/coverage/HunkCoverage";
import type { SessionManifest } from "../../domain/session/SessionManifest";
import type { RoundAnalysis } from "../analysis/RoundAnalysis";

/**
 * The `.prreview/` persistence port (ARCHITECTURE §11), implemented by
 * infrastructure/store/SessionStore. Saves are write-through with a short
 * debounce: the returned promise resolves when bytes hit disk, and callers
 * that must not wait fire-and-forget (flush() on shutdown covers them).
 * Reads reject with StoreError('corrupt' | 'schema-newer-than-binary'),
 * acquireLock with StoreError('locked'); everything else rejects raw.
 */
export interface SessionStore {
	acquireLock(changesetId: ChangesetId): Promise<void>;
	releaseLock(changesetId: ChangesetId): Promise<void>;
	loadSessionManifest(
		changesetId: ChangesetId,
	): Promise<SessionManifest | null>;
	saveSessionManifest(manifest: SessionManifest): Promise<void>;
	loadRoundChangeset(
		changesetId: ChangesetId,
		roundId: string,
	): Promise<FileDiff[] | null>;
	saveRoundChangeset(
		changesetId: ChangesetId,
		roundId: string,
		files: readonly FileDiff[],
	): Promise<void>;
	/** absent file means nothing seen yet — an empty record, not an error */
	loadCoverage(changesetId: ChangesetId): Promise<Record<string, HunkCoverage>>;
	saveCoverage(
		changesetId: ChangesetId,
		coverage: Readonly<Record<string, HunkCoverage>>,
	): Promise<void>;
	/** absent file means no annotation exists yet — an empty list, not an error */
	loadAnnotations(changesetId: ChangesetId): Promise<StoredAnnotation[]>;
	saveAnnotations(
		changesetId: ChangesetId,
		annotations: readonly StoredAnnotation[],
	): Promise<void>;
	/** null means this round has not been analyzed */
	loadRoundAnalysis(
		changesetId: ChangesetId,
		roundId: string,
	): Promise<RoundAnalysis | null>;
	saveRoundAnalysis(
		changesetId: ChangesetId,
		roundId: string,
		analysis: RoundAnalysis,
	): Promise<void>;
	/** null means the thread has no history yet */
	loadChatThread(
		changesetId: ChangesetId,
		threadId: string,
	): Promise<ChatThread | null>;
	saveChatThread(
		changesetId: ChangesetId,
		threadId: string,
		thread: ChatThread,
	): Promise<void>;
	/**
	 * Walkthrough position lives in the manifest as an optional field, not in a
	 * file of its own (CON-012: additive optional fields never bump the schema
	 * version). Null means the walkthrough was never entered.
	 */
	loadWalkthroughProgress(
		changesetId: ChangesetId,
	): Promise<WalkthroughProgress | null>;
	saveWalkthroughProgress(
		changesetId: ChangesetId,
		progress: WalkthroughProgress,
	): Promise<void>;
	writeBlob(oid: string, content: Buffer): Promise<void>;
	readBlob(oid: string): Promise<Buffer | null>;
	hasBlob(oid: string): Promise<boolean>;
	/** registers `.prreview/` in `<gitCommonDir>/info/exclude` (SEC-003) */
	ensureExcluded(gitCommonDir: string): Promise<void>;
	/** writes everything still sitting in the debounce window, now */
	flush(): Promise<void>;
}
