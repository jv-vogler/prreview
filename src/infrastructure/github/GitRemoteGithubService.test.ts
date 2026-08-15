import gitDiffParser from "gitdiff-parser";
import { afterAll, describe, expect, it } from "vitest";
import {
	createFixtureRepo,
	type FixtureRepo,
} from "../../../test/helpers/createFixtureRepo";
import { parseDiff } from "../../domain/changeset/parseDiff";
import { GithubError } from "../../domain/errors/GithubError";
import { GitClient } from "../git/GitClient";
import { GitRemoteGithubService } from "./GitRemoteGithubService";

const disposables: FixtureRepo[] = [];

async function fixtureRepo(): Promise<FixtureRepo> {
	const repo = await createFixtureRepo();
	disposables.push(repo);
	return repo;
}

async function trackClone(origin: FixtureRepo): Promise<FixtureRepo> {
	const cloned = await origin.clone();
	disposables.push(cloned);
	return cloned;
}

afterAll(async () => {
	await Promise.all(disposables.map((repo) => repo.dispose()));
});

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
	try {
		await promise;
	} catch (error) {
		return error;
	}
	throw new Error("expected the promise to reject");
}

/**
 * origin with a "PR": main gains an unrelated commit after the PR branch
 * forked, so tip-vs-tip would drag main's later change into the diff — the
 * merge-base behavior is exactly what distinguishes this backend.
 */
async function originWithPr(prNumber: number): Promise<{
	origin: FixtureRepo;
	prHeadSha: string;
}> {
	const origin = await fixtureRepo();
	await origin.git(["checkout", "--quiet", "-b", "feature"]);
	await origin.write("feature.txt", "the pr's change\n");
	const prHeadSha = await origin.commitAll("pr commit");
	await origin.git(["update-ref", `refs/pull/${prNumber}/head`, prHeadSha]);
	await origin.git(["checkout", "--quiet", "main"]);
	await origin.write("mainline.txt", "moved on after the fork\n");
	await origin.commitAll("main advances");
	return { origin, prHeadSha };
}

describe("probe", () => {
	it("answers git-remote when an origin remote exists", async () => {
		const origin = await fixtureRepo();
		const cloned = await trackClone(origin);
		const service = new GitRemoteGithubService(new GitClient(cloned.root));
		expect(await service.probe()).toEqual({ kind: "git-remote" });
	});

	it("answers none without a remote", async () => {
		const repo = await fixtureRepo();
		const service = new GitRemoteGithubService(new GitClient(repo.root));
		expect(await service.probe()).toEqual({ kind: "none" });
	});
});

describe("getPr", () => {
	it("throws GithubError('unsupported-backend'): no API, no metadata", async () => {
		const repo = await fixtureRepo();
		const service = new GitRemoteGithubService(new GitClient(repo.root));
		const error = await rejectionOf(service.getPr(482));
		expect(error).toBeInstanceOf(GithubError);
		expect((error as GithubError).reason).toBe("unsupported-backend");
	});
});

describe("getPrDiff", () => {
	it("diffs merge-base with the default branch against the fetched head", async () => {
		const { origin } = await originWithPr(9);
		const cloned = await trackClone(origin);
		const service = new GitRemoteGithubService(new GitClient(cloned.root));

		const files = parseDiff(gitDiffParser.parse(await service.getPrDiff(9)));
		const paths = files.map((file) => file.path);
		expect(paths).toEqual(["feature.txt"]);
	});
});

describe("fetchPrHead", () => {
	it("makes the PR head available locally via the pull ref", async () => {
		const { origin, prHeadSha } = await originWithPr(21);
		const cloned = await trackClone(origin);
		const git = new GitClient(cloned.root);
		const service = new GitRemoteGithubService(git);

		await service.fetchPrHead(21);
		expect(await git.verifyRef("refs/prreview/pr/21")).toBe(prHeadSha);
	});
});

describe("publish methods (M4 scope)", () => {
	it("throws GithubError('unsupported-backend')", async () => {
		const repo = await fixtureRepo();
		const service = new GitRemoteGithubService(new GitClient(repo.root));
		for (const call of [
			() => service.findPendingReview(1),
			() => service.createPendingReview(1, {}),
			() => service.deletePendingReview("id"),
		]) {
			const error = await rejectionOf(call());
			expect(error).toBeInstanceOf(GithubError);
			expect((error as GithubError).reason).toBe("unsupported-backend");
		}
	});
});

describe("getCurrentBranchPr", () => {
	it("throws GithubError('unsupported-backend') — no metadata without gh", async () => {
		const repo = await fixtureRepo();
		const service = new GitRemoteGithubService(new GitClient(repo.root));
		const error = await rejectionOf(service.getCurrentBranchPr());
		expect(error).toBeInstanceOf(GithubError);
		expect((error as GithubError).reason).toBe("unsupported-backend");
	});
});
