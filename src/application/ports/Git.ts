/**
 * The application's view of the local repository, implemented by
 * infrastructure/git/GitClient. Every method rejects raw on failure; the
 * use-cases convert the failures they expect into typed AppErrors.
 */
export interface Git {
	repoRoot(): Promise<string>;
	/** absolute path even in worktrees — where info/exclude lives */
	gitCommonDir(): Promise<string>;
	/** resolves any revision to a commit sha; rejects when it does not exist */
	verifyRef(ref: string): Promise<string>;
	/** rejects when origin/HEAD is unset and neither main nor master exists */
	defaultBranch(): Promise<string>;
	/** the checked-out branch name, or null on a detached HEAD */
	currentBranch(): Promise<string | null>;
	/** local branch names — the "did you mean" candidate pool */
	localBranches(): Promise<string[]>;
	/**
	 * Tracked staged or unstaged changes versus HEAD. Untracked files
	 * deliberately do not count: the worktree changeset (`git diff HEAD`)
	 * cannot show them, so treating them as dirt would auto-detect an empty
	 * review.
	 */
	isDirty(): Promise<boolean>;
	/** raw `git status --porcelain`, untracked files included (TASK-030) */
	statusPorcelain(): Promise<string>;
	remoteUrl(remoteName: string): Promise<string>;
	mergeBase(a: string, b: string): Promise<string>;
	/** commits reachable from `to` but not `from` — how far a ref moved; rejects when either is unknown */
	countCommits(from: string, to: string): Promise<number>;
	/** canonical diff text between two commits */
	diff(base: string, head: string): Promise<string>;
	/** staged + unstaged versus HEAD; untracked files do not appear */
	diffWorktree(): Promise<string>;
	readBlob(ref: string, path: string): Promise<Buffer>;
	readIndexBlob(path: string): Promise<Buffer>;
	/**
	 * Blob content by object id — how re-anchoring re-reads the side it
	 * captured a snapshot from, with no path involved.
	 */
	readObject(oid: string): Promise<Buffer>;
	/** working-tree content, contained to the repo root */
	readWorkingFile(path: string): Promise<Buffer>;
	hashObject(path: string): Promise<string>;
	worktreeFingerprint(): Promise<string>;
	/** makes the PR head commit available locally; resolves with its sha */
	fetchPrHead(prNumber: number): Promise<string>;
	/** detached checkout of one commit, outside the repo */
	addWorktree(dir: string, sha: string): Promise<void>;
	removeWorktree(dir: string): Promise<void>;
	/** clears registrations whose directories are gone (crash leftovers) */
	pruneWorktrees(): Promise<void>;
}
