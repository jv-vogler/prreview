export interface Git {
	repoRoot(): Promise<string>;
	gitCommonDir(): Promise<string>;
	verifyRef(ref: string): Promise<string>;
	defaultBranch(): Promise<string>;
	currentBranch(): Promise<string | null>;
	localBranches(): Promise<string[]>;
	isDirty(): Promise<boolean>;
	statusPorcelain(): Promise<string>;
	remoteUrl(remoteName: string): Promise<string>;
	mergeBase(a: string, b: string): Promise<string>;
	countCommits(from: string, to: string): Promise<number>;
	diff(base: string, head: string): Promise<string>;
	diffWorktree(): Promise<string>;
	readBlob(ref: string, path: string): Promise<Buffer>;
	readIndexBlob(path: string): Promise<Buffer>;
	readObject(oid: string): Promise<Buffer>;
	readWorkingFile(path: string): Promise<Buffer>;
	hashObject(path: string): Promise<string>;
	worktreeFingerprint(): Promise<string>;
	fetchPrHead(prNumber: number): Promise<string>;
	addWorktree(dir: string, sha: string): Promise<void>;
	removeWorktree(dir: string): Promise<void>;
	pruneWorktrees(): Promise<void>;
}
