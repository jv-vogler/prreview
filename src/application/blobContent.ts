import type { BlobRef } from "../domain/changeset/BlobRef";
import type { Git } from "./ports/Git";
import type { SessionStore } from "./ports/SessionStore";

/**
 * The lines behind one side of a file, for anchoring (ARCHITECTURE §6). In
 * plain terms: an anchor needs the file's actual text, and where that text
 * lives depends on the changeset — a commit's blob sits in git's object
 * database, a working-tree file sits on disk, and a worktree side prreview
 * already snapshotted sits in `.prreview/blobs/`.
 */
export interface BlobReaders {
	git: Pick<Git, "readObject" | "readWorkingFile">;
	store: Pick<SessionStore, "readBlob">;
}

export interface BlobLines {
	oid: string;
	lines: string[];
	/**
	 * True when the content came off the working tree rather than out of an
	 * immutable store, so the caller can persist it before the tree moves
	 * (§11's persisted worktree-side snapshots).
	 */
	fromWorkingTree: boolean;
	content: Buffer;
}

export interface ReadBlobLinesInput {
	ref: BlobRef;
	/**
	 * Repo-relative path of the file on that side, used only for the
	 * working-tree fallback: a worktree changeset's new side is diffed against
	 * a blob git hashed in memory and never wrote, so reading it by oid fails
	 * and the tree itself is the content.
	 */
	workingPath?: string;
}

export async function readBlobLines(
	readers: BlobReaders,
	input: ReadBlobLinesInput,
): Promise<BlobLines | null> {
	const { ref } = input;
	if (ref.kind === "worktree") {
		return readWorkingTree(readers, ref.path, ref.oid);
	}
	const fromObjectDatabase = await tryRead(() =>
		readers.git.readObject(ref.oid),
	);
	if (fromObjectDatabase !== null) {
		return toBlobLines(ref.oid, fromObjectDatabase, false);
	}
	const stored = await readers.store.readBlob(ref.oid);
	if (stored !== null) {
		return toBlobLines(ref.oid, stored, false);
	}
	if (input.workingPath === undefined) {
		return null;
	}
	return readWorkingTree(readers, input.workingPath, ref.oid);
}

async function readWorkingTree(
	readers: BlobReaders,
	path: string,
	oid: string,
): Promise<BlobLines | null> {
	const content = await tryRead(() => readers.git.readWorkingFile(path));
	return content === null ? null : toBlobLines(oid, content, true);
}

function toBlobLines(
	oid: string,
	content: Buffer,
	fromWorkingTree: boolean,
): BlobLines {
	return { oid, lines: splitLines(content), fromWorkingTree, content };
}

/**
 * Line 1 is `lines[0]`, matching the numbers a diff prints. A trailing newline
 * does not create an empty last line; a file with no trailing newline reads
 * identically, which is what makes anchors survive that difference.
 */
export function splitLines(content: Buffer): string[] {
	const text = content.toString("utf8").replace(/\n$/, "");
	return text === "" ? [] : text.split("\n");
}

/** git and the store both throw on a missing object; absence is not an error here. */
async function tryRead(read: () => Promise<Buffer>): Promise<Buffer | null> {
	try {
		return await read();
	} catch {
		return null;
	}
}
