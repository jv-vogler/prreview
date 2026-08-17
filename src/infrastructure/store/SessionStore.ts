import {
	access,
	mkdir,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import type { RoundAnalysis } from "../../application/analysis/RoundAnalysis";
import type { StoredAnnotation } from "../../domain/annotation/Annotation";
import type { ChangesetId } from "../../domain/changeset/ChangesetId";
import type { FileDiff } from "../../domain/changeset/FileDiff";
import type { ChatThread } from "../../domain/chat/ChatThread";
import type { HunkCoverage } from "../../domain/coverage/HunkCoverage";
import { StoreError } from "../../domain/errors/StoreError";
import { migrate } from "../../domain/session/migrate";
import type { SessionManifest } from "../../domain/session/SessionManifest";
import {
	annotationsSchema,
	chatThreadSchema,
	coverageSchema,
	roundAnalysisSchema,
	roundChangesetSchema,
	sessionManifestSchema,
} from "./schemas";
import { sessionKeyFor } from "./sessionKey";

/**
 * Write-through with a short batching window: the first save schedules a
 * write, later saves inside the window just refresh the data, so scroll-speed
 * coverage updates cost one fsync per window and crash safety never depends
 * on shutdown (ARCHITECTURE §3, §11).
 */
const DEFAULT_DEBOUNCE_MS = 500;

const GIT_EXCLUDE_ENTRY = ".prreview/";

// Blob oids come from `git hash-object` (sha1 or sha256 hex); anything else
// must never become a filename under blobs/.
const OID_PATTERN = /^[0-9a-f]{40,64}$/;

// Thread ids are server-generated (`t1` in M2) and become a filename; keeping
// them alphanumeric means a future client-supplied id can never traverse.
const THREAD_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export interface SessionStoreOptions {
	/** absolute path to the `.prreview/` directory */
	dataDir: string;
	/** test seam only — production uses the default window */
	debounceMs?: number;
}

interface PendingWrite {
	data: string;
	timer: NodeJS.Timeout;
	promise: Promise<void>;
	resolve: () => void;
	reject: (error: unknown) => void;
}

/**
 * The `.prreview/` JSON store (ARCHITECTURE §11): plain files a user can
 * grep, written atomically via temp+rename, debounced, content-addressed
 * blobs on the side. Per CON-003 this adapter throws raw fs errors — with
 * the store-owned exceptions the plan names: unreadable/invalid session
 * files are StoreError('corrupt') (after the schemaVersion gate, which may
 * refuse with 'schema-newer-than-binary'), and a live pidfile is
 * StoreError('locked').
 */
export class SessionStore {
	private readonly dataDir: string;
	private readonly debounceMs: number;
	private readonly pendingWrites = new Map<string, PendingWrite>();
	private temporaryFileCounter = 0;

	constructor(options: SessionStoreOptions) {
		this.dataDir = options.dataDir;
		this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
	}

	// ── lock ──────────────────────────────────────────────────────────────

	/** One server per session: a pidfile named `lock` in the session dir. */
	async acquireLock(changesetId: ChangesetId): Promise<void> {
		const lockPath = this.lockPath(changesetId);
		await mkdir(dirname(lockPath), { recursive: true });

		if (await this.tryWriteLock(lockPath)) {
			return;
		}

		const holderPid = await this.readLockPid(lockPath);
		if (holderPid !== null && isProcessAlive(holderPid)) {
			throw new StoreError(
				"locked",
				`Another prreview (pid ${holderPid}) is already serving this session. Close it first, or delete ${lockPath} if it crashed.`,
			);
		}

		// The previous owner is gone (or left garbage): break the stale lock.
		await rm(lockPath, { force: true });
		if (await this.tryWriteLock(lockPath)) {
			return;
		}
		throw new StoreError(
			"locked",
			`Another prreview grabbed this session's lock first (${lockPath}).`,
		);
	}

	async releaseLock(changesetId: ChangesetId): Promise<void> {
		const lockPath = this.lockPath(changesetId);
		const holderPid = await this.readLockPid(lockPath);
		if (holderPid === process.pid) {
			await rm(lockPath, { force: true });
		}
	}

	// ── session manifest ──────────────────────────────────────────────────

	async loadSessionManifest(
		changesetId: ChangesetId,
	): Promise<SessionManifest | null> {
		const path = this.sessionManifestPath(changesetId);
		const raw = await this.readJsonFile(path);
		if (raw === undefined) {
			return null;
		}
		const schemaVersion = (raw as { schemaVersion?: unknown }).schemaVersion;
		if (typeof schemaVersion !== "number") {
			throw corrupt(path, "it has no numeric schemaVersion");
		}
		const migrated = migrate(raw as { schemaVersion: number });
		const parsed = sessionManifestSchema.safeParse(migrated);
		if (!parsed.success) {
			throw corrupt(path, "it does not match the session schema");
		}
		return parsed.data;
	}

	/** Debounced; resolves when the manifest is on disk. */
	saveSessionManifest(manifest: SessionManifest): Promise<void> {
		return this.scheduleWrite(
			this.sessionManifestPath(manifest.changesetId),
			manifest,
		);
	}

	// ── rounds ────────────────────────────────────────────────────────────

	async loadRoundChangeset(
		changesetId: ChangesetId,
		roundId: string,
	): Promise<FileDiff[] | null> {
		const path = this.roundChangesetPath(changesetId, roundId);
		const raw = await this.readJsonFile(path);
		if (raw === undefined) {
			return null;
		}
		const parsed = roundChangesetSchema.safeParse(raw);
		if (!parsed.success) {
			throw corrupt(path, "it does not match the changeset snapshot schema");
		}
		return parsed.data;
	}

	/** Debounced; the IR snapshot is stored, never recomputed (ARCHITECTURE §11). */
	saveRoundChangeset(
		changesetId: ChangesetId,
		roundId: string,
		files: readonly FileDiff[],
	): Promise<void> {
		return this.scheduleWrite(
			this.roundChangesetPath(changesetId, roundId),
			files,
		);
	}

	// ── coverage ──────────────────────────────────────────────────────────

	/** Absent file means nothing seen yet — an empty record, not an error. */
	async loadCoverage(
		changesetId: ChangesetId,
	): Promise<Record<string, HunkCoverage>> {
		const path = this.coveragePath(changesetId);
		const raw = await this.readJsonFile(path);
		if (raw === undefined) {
			return {};
		}
		const parsed = coverageSchema.safeParse(raw);
		if (!parsed.success) {
			throw corrupt(path, "it does not match the coverage schema");
		}
		return parsed.data;
	}

	saveCoverage(
		changesetId: ChangesetId,
		coverage: Readonly<Record<string, HunkCoverage>>,
	): Promise<void> {
		return this.scheduleWrite(this.coveragePath(changesetId), coverage);
	}

	// ── annotations ───────────────────────────────────────────────────────

	/** Absent file means no annotation exists yet — an empty list, not an error. */
	async loadAnnotations(changesetId: ChangesetId): Promise<StoredAnnotation[]> {
		const path = this.annotationsPath(changesetId);
		const raw = await this.readJsonFile(path);
		if (raw === undefined) {
			return [];
		}
		const parsed = annotationsSchema.safeParse(raw);
		if (!parsed.success) {
			throw corrupt(path, "it does not match the annotation schema");
		}
		return parsed.data;
	}

	saveAnnotations(
		changesetId: ChangesetId,
		annotations: readonly StoredAnnotation[],
	): Promise<void> {
		return this.scheduleWrite(this.annotationsPath(changesetId), annotations);
	}

	// ── round analysis ────────────────────────────────────────────────────

	async loadRoundAnalysis(
		changesetId: ChangesetId,
		roundId: string,
	): Promise<RoundAnalysis | null> {
		const path = this.roundAnalysisPath(changesetId, roundId);
		const raw = await this.readJsonFile(path);
		if (raw === undefined) {
			return null;
		}
		const parsed = roundAnalysisSchema.safeParse(raw);
		if (!parsed.success) {
			throw corrupt(path, "it does not match the analysis schema");
		}
		return parsed.data;
	}

	saveRoundAnalysis(
		changesetId: ChangesetId,
		roundId: string,
		analysis: RoundAnalysis,
	): Promise<void> {
		return this.scheduleWrite(
			this.roundAnalysisPath(changesetId, roundId),
			analysis,
		);
	}

	// ── chat threads ──────────────────────────────────────────────────────

	async loadChatThread(
		changesetId: ChangesetId,
		threadId: string,
	): Promise<ChatThread | null> {
		const path = this.chatThreadPath(changesetId, threadId);
		const raw = await this.readJsonFile(path);
		if (raw === undefined) {
			return null;
		}
		const parsed = chatThreadSchema.safeParse(raw);
		if (!parsed.success) {
			throw corrupt(path, "it does not match the chat thread schema");
		}
		return parsed.data;
	}

	saveChatThread(
		changesetId: ChangesetId,
		threadId: string,
		thread: ChatThread,
	): Promise<void> {
		return this.scheduleWrite(
			this.chatThreadPath(changesetId, threadId),
			thread,
		);
	}

	// ── blobs ─────────────────────────────────────────────────────────────

	/**
	 * Content-addressed and immediate (no debounce: a blob write happens once
	 * per oid and is already idempotent). Writing an oid that exists is a
	 * no-op by definition of content addressing.
	 */
	async writeBlob(oid: string, content: Buffer): Promise<void> {
		const path = this.blobPath(oid);
		if (await fileExists(path)) {
			return;
		}
		await this.writeFileAtomic(path, content);
	}

	async readBlob(oid: string): Promise<Buffer | null> {
		try {
			return await readFile(this.blobPath(oid));
		} catch (error) {
			if (isFileMissingError(error)) {
				return null;
			}
			throw error;
		}
	}

	async hasBlob(oid: string): Promise<boolean> {
		return fileExists(this.blobPath(oid));
	}

	// ── git exclusion (SEC-003) ───────────────────────────────────────────

	/**
	 * Registers `.prreview/` in `<gitCommonDir>/info/exclude` — never in the
	 * user's .gitignore (SEC-003). Idempotent; creates info/exclude when the
	 * repo has none.
	 */
	async ensureExcluded(gitCommonDir: string): Promise<void> {
		const excludePath = join(gitCommonDir, "info", "exclude");
		const existing = await readTextFileIfPresent(excludePath);
		const alreadyRegistered = (existing ?? "")
			.split("\n")
			.some((line) => line.trim() === GIT_EXCLUDE_ENTRY);
		if (alreadyRegistered) {
			return;
		}
		const base =
			existing === undefined || existing === ""
				? ""
				: existing.endsWith("\n")
					? existing
					: `${existing}\n`;
		await this.writeFileAtomic(excludePath, `${base}${GIT_EXCLUDE_ENTRY}\n`);
	}

	// ── flushing ──────────────────────────────────────────────────────────

	/**
	 * Writes everything still sitting in the debounce window, now. The
	 * shutdown path calls this before exit; tests call it instead of waiting.
	 */
	async flush(): Promise<void> {
		const scheduled = [...this.pendingWrites.keys()];
		await Promise.all(scheduled.map((path) => this.performWrite(path)));
	}

	// ── internals ─────────────────────────────────────────────────────────

	private scheduleWrite(absolutePath: string, payload: unknown): Promise<void> {
		const data = `${JSON.stringify(payload, null, "\t")}\n`;

		const existing = this.pendingWrites.get(absolutePath);
		if (existing) {
			existing.data = data;
			return existing.promise;
		}

		let resolve!: () => void;
		let reject!: (error: unknown) => void;
		const promise = new Promise<void>((res, rej) => {
			resolve = res;
			reject = rej;
		});
		// A caller may fire-and-forget; the rejection still reaches anyone who
		// awaits, but must never become an unhandled-rejection crash.
		promise.catch(() => {});

		const timer = setTimeout(() => {
			// The failure already travels through the pending write's promise;
			// the timer callback itself must never become an unhandled rejection.
			this.performWrite(absolutePath).catch(() => {});
		}, this.debounceMs);
		timer.unref();

		this.pendingWrites.set(absolutePath, {
			data,
			timer,
			promise,
			resolve,
			reject,
		});
		return promise;
	}

	private async performWrite(absolutePath: string): Promise<void> {
		const pending = this.pendingWrites.get(absolutePath);
		if (!pending) {
			return;
		}
		this.pendingWrites.delete(absolutePath);
		clearTimeout(pending.timer);
		try {
			await this.writeFileAtomic(absolutePath, pending.data);
			pending.resolve();
		} catch (error) {
			pending.reject(error);
			throw error;
		}
	}

	private async writeFileAtomic(
		absolutePath: string,
		data: string | Buffer,
	): Promise<void> {
		await mkdir(dirname(absolutePath), { recursive: true });
		const temporaryPath = `${absolutePath}.${process.pid}.${this.temporaryFileCounter++}.tmp`;
		await writeFile(temporaryPath, data);
		await rename(temporaryPath, absolutePath);
	}

	private async readJsonFile(absolutePath: string): Promise<unknown> {
		// A read that ignored the debounce window would see the previous
		// contents and a read-modify-write (the ticket hint lands in the
		// manifest) would silently drop whatever is still pending.
		const pending = this.pendingWrites.get(absolutePath);
		const text =
			pending === undefined
				? await readTextFileIfPresent(absolutePath)
				: pending.data;
		if (text === undefined) {
			return undefined;
		}
		try {
			return JSON.parse(text) as unknown;
		} catch {
			throw corrupt(absolutePath, "it is not valid JSON");
		}
	}

	private async tryWriteLock(lockPath: string): Promise<boolean> {
		try {
			await writeFile(lockPath, String(process.pid), { flag: "wx" });
			return true;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "EEXIST") {
				return false;
			}
			throw error;
		}
	}

	private async readLockPid(lockPath: string): Promise<number | null> {
		const content = await readTextFileIfPresent(lockPath);
		if (content === undefined) {
			return null;
		}
		const pid = Number.parseInt(content.trim(), 10);
		return Number.isInteger(pid) && pid > 0 ? pid : null;
	}

	private sessionDir(changesetId: ChangesetId): string {
		return join(this.dataDir, "sessions", sessionKeyFor(changesetId));
	}

	private lockPath(changesetId: ChangesetId): string {
		return join(this.sessionDir(changesetId), "lock");
	}

	private sessionManifestPath(changesetId: ChangesetId): string {
		return join(this.sessionDir(changesetId), "session.json");
	}

	private roundChangesetPath(
		changesetId: ChangesetId,
		roundId: string,
	): string {
		return join(
			this.sessionDir(changesetId),
			"rounds",
			roundId,
			"changeset.json",
		);
	}

	private roundAnalysisPath(changesetId: ChangesetId, roundId: string): string {
		return join(
			this.sessionDir(changesetId),
			"rounds",
			roundId,
			"analysis.json",
		);
	}

	private coveragePath(changesetId: ChangesetId): string {
		return join(this.sessionDir(changesetId), "coverage.json");
	}

	private annotationsPath(changesetId: ChangesetId): string {
		return join(this.sessionDir(changesetId), "annotations.json");
	}

	private chatThreadPath(changesetId: ChangesetId, threadId: string): string {
		if (!THREAD_ID_PATTERN.test(threadId)) {
			throw new Error(`not a thread id: ${JSON.stringify(threadId)}`);
		}
		return join(this.sessionDir(changesetId), "chat", `${threadId}.json`);
	}

	private blobPath(oid: string): string {
		if (!OID_PATTERN.test(oid)) {
			throw new Error(`not a blob oid: ${JSON.stringify(oid)}`);
		}
		return join(this.dataDir, "blobs", oid);
	}
}

function corrupt(path: string, why: string): StoreError {
	return new StoreError(
		"corrupt",
		`${path} is unreadable: ${why}. Delete .prreview/ to reset the session.`,
	);
}

function isFileMissingError(error: unknown): boolean {
	return (error as NodeJS.ErrnoException).code === "ENOENT";
}

async function readTextFileIfPresent(
	absolutePath: string,
): Promise<string | undefined> {
	try {
		return await readFile(absolutePath, "utf8");
	} catch (error) {
		if (isFileMissingError(error)) {
			return undefined;
		}
		throw error;
	}
}

async function fileExists(absolutePath: string): Promise<boolean> {
	try {
		await access(absolutePath);
		return true;
	} catch {
		return false;
	}
}

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		// EPERM: it exists but belongs to someone else — very much alive.
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}
