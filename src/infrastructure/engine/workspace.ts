import { createHash } from "node:crypto";
import { access, constants, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ChangesetSource } from "../../domain/changeset/ChangesetSource";

/**
 * Where the agent runs (REQ-005, ARCHITECTURE §7). In plain terms: every claim
 * the agent makes has to come from the code as reviewed, so prreview either
 * points it at the repo itself — when the repo already holds that code — or
 * checks the reviewed commit out into a throwaway directory under the user's
 * cache, never inside the repo.
 *
 * Lifetime, the owner's recorded decision: `prune()` at boot clears crash
 * leftovers, and `release()` at shutdown removes the checkouts this process
 * created, so an `npx` tool never grows a cache of stale worktrees (RISK-005).
 */
export interface EngineWorkspaces {
	ensure(request: WorkspaceRequest): Promise<Workspace>;
	/** `git worktree prune` — run once at boot */
	prune(): Promise<void>;
	/** removes every worktree this process created */
	release(): Promise<void>;
}

export interface WorkspaceRequest {
	source: ChangesetSource;
	/** null for a worktree changeset: the code under review is the tree itself */
	headSha: string | null;
}

export interface Workspace {
	dir: string;
	/** `repo` = the user's own checkout; `worktree` = a detached materialization */
	kind: "repo" | "worktree";
}

/** the structural slice of the git adapter this module needs */
export interface WorktreeGit {
	verifyRef(ref: string): Promise<string>;
	addWorktree(dir: string, sha: string): Promise<void>;
	removeWorktree(dir: string): Promise<void>;
	pruneWorktrees(): Promise<void>;
}

export interface EngineWorkspacesOptions {
	git: WorktreeGit;
	repoRoot: string;
	/** the engine-workspace root; `defaultEngineCacheDir()` supplies the default */
	cacheDir: string;
}

const WORKTREES_DIR = "worktrees";
/** long enough that two repos on one machine cannot collide in practice */
const REPO_HASH_LENGTH = 12;

export function createEngineWorkspaces(
	options: EngineWorkspacesOptions,
): EngineWorkspaces {
	const { git, repoRoot, cacheDir } = options;
	const created = new Set<string>();

	async function ensure(request: WorkspaceRequest): Promise<Workspace> {
		if (request.source.kind === "worktree" || request.headSha === null) {
			// the reviewed code IS the working tree; nothing to materialize
			return { dir: repoRoot, kind: "repo" };
		}
		if (await isCurrentHead(request.headSha)) {
			return { dir: repoRoot, kind: "repo" };
		}

		const dir = worktreeDirFor(cacheDir, repoRoot, request.headSha);
		if (await isUsableWorktree(dir)) {
			return { dir, kind: "worktree" };
		}
		// A leftover shell from a crashed run still occupies the path, and
		// `git worktree add` refuses a non-empty directory — clear it, then
		// drop the registration that now points nowhere, then materialize.
		await rm(dir, { recursive: true, force: true });
		await git.pruneWorktrees();
		await git.addWorktree(dir, request.headSha);
		created.add(dir);
		return { dir, kind: "worktree" };
	}

	async function isCurrentHead(headSha: string): Promise<boolean> {
		try {
			return (await git.verifyRef("HEAD")) === headSha;
		} catch {
			// an unborn HEAD is not the reviewed revision by definition
			return false;
		}
	}

	return {
		ensure,
		prune: () => git.pruneWorktrees(),
		release: async () => {
			for (const dir of created) {
				try {
					await git.removeWorktree(dir);
				} catch {
					// shutdown is not the place to fail: prune at the next boot
					// clears whatever a locked or vanished checkout left behind
				}
			}
			created.clear();
		},
	};
}

/**
 * `<cacheDir>/worktrees/<repoHash>/<headSha>` — the repo hash keeps two
 * clones of the same project apart, and the sha makes reuse trivial.
 */
export function worktreeDirFor(
	cacheDir: string,
	repoRoot: string,
	headSha: string,
): string {
	const repoHash = createHash("sha256")
		.update(repoRoot)
		.digest("hex")
		.slice(0, REPO_HASH_LENGTH);
	return join(cacheDir, WORKTREES_DIR, repoHash, headSha);
}

/**
 * A materialized worktree carries a `.git` **file** pointing back at the
 * repo's admin directory. Its absence means the directory is a leftover shell
 * (a crashed run, a manually deleted checkout) and must be rebuilt.
 */
async function isUsableWorktree(dir: string): Promise<boolean> {
	try {
		await access(join(dir, ".git"), constants.R_OK);
		return true;
	} catch {
		return false;
	}
}

/**
 * `$XDG_CACHE_HOME/prreview` or `~/.cache/prreview` — outside the repo,
 * unconditionally (ARCHITECTURE §11: prreview writes nothing into the user's
 * tree beyond `.prreview/`).
 */
export function defaultEngineCacheDir(
	env: NodeJS.ProcessEnv = process.env,
): string {
	const xdgCacheHome = env.XDG_CACHE_HOME;
	const base =
		xdgCacheHome !== undefined && xdgCacheHome !== ""
			? xdgCacheHome
			: join(homedir(), ".cache");
	return join(base, "prreview");
}
