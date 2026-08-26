import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { SessionStore as SessionStorePort } from "../../application/ports/SessionStore";
import type { ChangesetId } from "../../domain/changeset/ChangesetId";
import { StoreError } from "../../domain/errors/StoreError";
import type { StoredReview } from "../../domain/pass/StoredReview";
import { storedReviewSchema } from "./schemas";
import { sessionKeyFor } from "./sessionKey";

const DEFAULT_DEBOUNCE_MS = 500;

const GIT_EXCLUDE_ENTRY = ".prreview/";

export interface SessionStoreOptions {
	dataDir: string;
	debounceMs?: number;
}

interface PendingWrite {
	data: string;
	timer: NodeJS.Timeout;
	promise: Promise<void>;
	resolve: () => void;
	reject: (error: unknown) => void;
}

export class SessionStore implements SessionStorePort {
	private readonly dataDir: string;
	private readonly debounceMs: number;
	private readonly pendingWrites = new Map<string, PendingWrite>();
	private temporaryFileCounter = 0;

	constructor(options: SessionStoreOptions) {
		this.dataDir = options.dataDir;
		this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
	}

	async loadReview(changesetId: ChangesetId): Promise<StoredReview | null> {
		const path = this.reviewPath(changesetId);
		const raw = await this.readJsonFile(path);
		if (raw === undefined) {
			return null;
		}
		const parsed = storedReviewSchema.safeParse(raw);
		if (!parsed.success) {
			throw corrupt(path, "it does not match the review artifact schema");
		}
		return parsed.data;
	}

	saveReview(review: StoredReview): Promise<void> {
		return this.scheduleWrite(this.reviewPath(review.changesetId), review);
	}

	async ensureExcluded(gitCommonDir: string): Promise<void> {
		const excludePath = join(gitCommonDir, "info", "exclude");
		const existing = await readTextFileIfPresent(excludePath);
		const alreadyRegistered = (existing ?? "")
			.split("\n")
			.some((line) => line.trim() === GIT_EXCLUDE_ENTRY);
		if (alreadyRegistered) {
			return;
		}
		const base = newlineTerminated(existing);
		await this.writeFileAtomic(excludePath, `${base}${GIT_EXCLUDE_ENTRY}\n`);
	}

	async flush(): Promise<void> {
		const scheduled = [...this.pendingWrites.keys()];
		await Promise.all(scheduled.map((path) => this.performWrite(path)));
	}

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

		promise.catch(() => {});

		const timer = setTimeout(() => {
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

	private sessionDir(changesetId: ChangesetId): string {
		return join(this.dataDir, "sessions", sessionKeyFor(changesetId));
	}

	private reviewPath(changesetId: ChangesetId): string {
		return join(this.sessionDir(changesetId), "review.json");
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

function newlineTerminated(existing: string | undefined): string {
	if (existing === undefined || existing === "") {
		return "";
	}
	return existing.endsWith("\n") ? existing : `${existing}\n`;
}
