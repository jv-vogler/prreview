/**
 * The application's view of the local repository (ARCHITECTURE §2, §4),
 * implemented by infrastructure/git/GitClient. Every method rejects raw on
 * failure (CON-003); the use-cases convert the failures they expect into
 * typed AppErrors.
 */
export interface Git {
	repoRoot(): Promise<string>;
	/** absolute path even in worktrees — where info/exclude lives (SEC-003) */
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
	 * cannot show them, so treating them as dirt would auto-detect an
	 * empty review.
	 */
	isDirty(): Promise<boolean>;
	remoteUrl(remoteName: string): Promise<string>;
	mergeBase(a: string, b: string): Promise<string>;
	/** canonical diff text between two commits (ARCHITECTURE §5) */
	diff(base: string, head: string): Promise<string>;
	/** staged + unstaged versus HEAD; untracked files do not appear */
	diffWorktree(): Promise<string>;
	readBlob(ref: string, path: string): Promise<Buffer>;
	readIndexBlob(path: string): Promise<Buffer>;
	hashObject(path: string): Promise<string>;
	worktreeFingerprint(): Promise<string>;
	/** makes the PR head commit available locally; resolves with its sha */
	fetchPrHead(prNumber: number): Promise<string>;
}
