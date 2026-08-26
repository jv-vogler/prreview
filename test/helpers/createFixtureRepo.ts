import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { devNull, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { exec } from "../../src/infrastructure/git/exec";

const FIXTURE_GIT_ENV = {
	GIT_DIR: undefined,
	GIT_WORK_TREE: undefined,
	GIT_INDEX_FILE: undefined,
	GIT_PREFIX: undefined,
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
	git(args: readonly string[]): Promise<string>;
	write(relativePath: string, content: string | Buffer): Promise<void>;
	remove(relativePath: string): Promise<void>;
	commitAll(message: string): Promise<string>;
	headSha(): Promise<string>;
	clone(): Promise<FixtureRepo>;
	dispose(): Promise<void>;
}

export interface FixtureRepoOptions {
	defaultBranch?: string;
	initialCommit?: boolean;
}

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
		await commitEverything(root, "initial commit");
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
			await commitEverything(root, message);
			return readHeadSha(root);
		},

		headSha: () => readHeadSha(root),

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

async function commitEverything(root: string, message: string): Promise<void> {
	await runGit(root, ["add", "-A"]);
	await runGit(root, ["commit", "--quiet", "-m", message]);
}

async function readHeadSha(root: string): Promise<string> {
	return (await runGit(root, ["rev-parse", "HEAD"])).trim();
}

function runGit(cwd: string, args: readonly string[]): Promise<string> {
	return exec("git", args, { cwd, env: FIXTURE_GIT_ENV });
}
