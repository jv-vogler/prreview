import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { devNull, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { exec } from "../../src/infrastructure/git/exec";

/**
 * Env for every git command a fixture runs: user config is blanked so the
 * machine's gitconfig cannot shape fixture content, and identity comes from
 * env so commits work on a bare CI runner.
 */
const FIXTURE_GIT_ENV = {
	GIT_CONFIG_GLOBAL: devNull,
	GIT_CONFIG_SYSTEM: devNull,
	GIT_AUTHOR_NAME: "Fixture",
	GIT_AUTHOR_EMAIL: "fixture@example.invalid",
	GIT_COMMITTER_NAME: "Fixture",
	GIT_COMMITTER_EMAIL: "fixture@example.invalid",
	GIT_TERMINAL_PROMPT: "0",
};

export interface FixtureRepo {
	readonly root: string;
	/** run git inside the repo with the fixture env; returns stdout */
	git(args: readonly string[]): Promise<string>;
	write(relativePath: string, content: string | Buffer): Promise<void>;
	remove(relativePath: string): Promise<void>;
	/** `git add -A` + commit; returns the new head sha */
	commitAll(message: string): Promise<string>;
	headSha(): Promise<string>;
	/** clone this repo into a fresh temp dir (sets origin and origin/HEAD) */
	clone(): Promise<FixtureRepo>;
	dispose(): Promise<void>;
}

export interface FixtureRepoOptions {
	/** branch name for `git init -b`; default "main" */
	defaultBranch?: string;
	/** create the initial README commit; default true */
	initialCommit?: boolean;
}

/**
 * A real git repository in a temp directory — the adapter tests' ground
 * truth. Compose commits, branches, renames, binary files, and dirty state
 * through the returned handle.
 */
export async function createFixtureRepo(
	options: FixtureRepoOptions = {},
): Promise<FixtureRepo> {
	const root = await mkdtemp(join(tmpdir(), "prreview-fixture-"));
	await runGit(root, [
		"init",
		"--quiet",
		"-b",
		options.defaultBranch ?? "main",
	]);
	const repo = makeHandle(root);
	if (options.initialCommit !== false) {
		await repo.write("README.md", "# fixture\n");
		await repo.commitAll("initial commit");
	}
	return repo;
}

function makeHandle(root: string): FixtureRepo {
	const repo: FixtureRepo = {
		root,

		git: (args) => runGit(root, args),

		write: async (relativePath, content) => {
			const absolute = join(root, relativePath);
			await mkdir(dirname(absolute), { recursive: true });
			await writeFile(absolute, content);
		},

		remove: (relativePath) => unlink(join(root, relativePath)),

		commitAll: async (message) => {
			await runGit(root, ["add", "-A"]);
			await runGit(root, ["commit", "--quiet", "-m", message]);
			return repo.headSha();
		},

		headSha: async () => (await runGit(root, ["rev-parse", "HEAD"])).trim(),

		clone: async () => {
			const cloneRoot = await mkdtemp(join(tmpdir(), "prreview-fixture-"));
			await exec("git", ["clone", "--quiet", root, cloneRoot], {
				env: FIXTURE_GIT_ENV,
			});
			return makeHandle(cloneRoot);
		},

		dispose: () => rm(root, { recursive: true, force: true }),
	};
	return repo;
}

function runGit(cwd: string, args: readonly string[]): Promise<string> {
	return exec("git", args, { cwd, env: FIXTURE_GIT_ENV });
}
