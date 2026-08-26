import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import gitDiffParser from "gitdiff-parser";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
	createFixtureRepo,
	type FixtureRepo,
} from "../../../test/helpers/createFixtureRepo";
import { createPathShim, type PathShim } from "../../../test/helpers/shimPath";
import { AppError } from "../../domain/errors/AppError";
import { GitClient } from "../git/GitClient";
import { GhCliGithubService } from "./GhCliGithubService";

const FAKE_ENV_KNOBS = [
	"FAKE_GH_LOG",
	"FAKE_GH_VERSION_EXIT",
	"FAKE_GH_AUTH_EXIT",
	"FAKE_GH_PR_VIEW_EXIT",
	"FAKE_GH_PR_VIEW_JSON",
	"FAKE_GH_PR_DIFF_EXIT",
	"FAKE_GH_PR_DIFF",
	"FAKE_GH_REVIEWS_JSON",
	"FAKE_GH_REVIEW_CREATE_EXIT",
	"FAKE_GH_REVIEW_CREATE_JSON",
	"FAKE_GH_REVIEW_DELETE_EXIT",
];

let shim: PathShim;
let repo: FixtureRepo;
let service: GhCliGithubService;
let originalPath: string | undefined;

beforeAll(async () => {
	originalPath = process.env.PATH;
	shim = await createPathShim();
	process.env.PATH = shim.withFakes;
	repo = await createFixtureRepo();
	service = new GhCliGithubService(new GitClient(repo.root), repo.root);
});

afterAll(async () => {
	process.env.PATH = originalPath;
	await shim.dispose();
	await repo.dispose();
});

afterEach(() => {
	process.env.PATH = shim.withFakes;
	for (const knob of FAKE_ENV_KNOBS) {
		delete process.env[knob];
	}
});

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
	try {
		await promise;
	} catch (error) {
		return error;
	}
	throw new Error("expected the promise to reject");
}

describe("probe", () => {
	it("answers gh when the CLI exists and holds a token", async () => {
		expect(await service.probe()).toEqual({ kind: "gh" });
	});

	it("answers none when gh is unauthenticated", async () => {
		process.env.FAKE_GH_AUTH_EXIT = "1";
		expect(await service.probe()).toEqual({ kind: "none" });
	});

	it("answers none when gh is not installed at all", async () => {
		process.env.PATH = shim.gitOnly;
		expect(await service.probe()).toEqual({ kind: "none" });
	});
});

describe("getPr", () => {
	it("parses gh's JSON into PR metadata", async () => {
		const pr = await service.getPr(482);
		expect(pr).toEqual({
			title: "Add rate limiting",
			body: "Token bucket per client.",
			baseRefName: "main",
			headRefName: "feat/rate-limit",
			headRefOid: "0123456789abcdef0123456789abcdef01234567",
			url: "https://github.com/acme/api/pull/482",
			state: "OPEN",
		});
	});

	it("requests exactly the fields the PrInfo shape needs", async () => {
		const logDirectory = await mkdtemp(join(tmpdir(), "prreview-ghlog-"));
		const logPath = join(logDirectory, "invocations.log");
		process.env.FAKE_GH_LOG = logPath;
		try {
			await service.getPr(482);
			const log = await readFile(logPath, "utf8");
			expect(log.trim()).toBe(
				"pr view 482 --json title,body,baseRefName,headRefName,headRefOid,url,state",
			);
		} finally {
			await rm(logDirectory, { recursive: true, force: true });
		}
	});

	it("throws raw on gh failure, stderr preserved as cause", async () => {
		process.env.FAKE_GH_PR_VIEW_EXIT = "1";
		const error = await rejectionOf(service.getPr(9999));
		expect(error).not.toBeInstanceOf(AppError);
		expect(String((error as Error).cause)).toContain("no pull requests");
	});
});

describe("getPrDiff", () => {
	it("returns diff text that the one shared parser accepts", async () => {
		const diffText = await service.getPrDiff(482);
		const files = gitDiffParser.parse(diffText);
		expect(files).toHaveLength(1);
		expect(files[0].newPath).toBe("src/limiter.ts");
	});
});

describe("fetchPrHead", () => {
	it("delegates to git, which fetches the pull ref from origin", async () => {
		const origin = await createFixtureRepo();
		try {
			await origin.git(["checkout", "--quiet", "-b", "feature"]);
			await origin.write("feature.txt", "pr content\n");
			const prHeadSha = await origin.commitAll("pr commit");
			await origin.git(["update-ref", "refs/pull/12/head", prHeadSha]);
			await origin.git(["checkout", "--quiet", "main"]);
			const cloned = await origin.clone();
			try {
				const git = new GitClient(cloned.root);
				const clonedService = new GhCliGithubService(git, cloned.root);
				await clonedService.fetchPrHead(12);
				expect(await git.verifyRef("refs/prreview/pr/12")).toBe(prHeadSha);
			} finally {
				await cloned.dispose();
			}
		} finally {
			await origin.dispose();
		}
	});
});

describe("getCurrentBranchPr", () => {
	it("asks gh for the current branch's PR — no number in the argv", async () => {
		const logDirectory = await mkdtemp(join(tmpdir(), "prreview-ghlog-"));
		const logPath = join(logDirectory, "invocations.log");
		process.env.FAKE_GH_LOG = logPath;
		try {
			const pr = await service.getCurrentBranchPr();
			expect(pr.url).toBe("https://github.com/acme/api/pull/482");
			expect(pr.state).toBe("OPEN");
			const log = await readFile(logPath, "utf8");
			expect(log.trim()).toBe(
				"pr view --json title,body,baseRefName,headRefName,headRefOid,url,state",
			);
		} finally {
			await rm(logDirectory, { recursive: true, force: true });
		}
	});

	it("throws raw when the branch has no PR (the auto-detect rung falls through upstairs)", async () => {
		process.env.FAKE_GH_PR_VIEW_EXIT = "1";
		const error = await rejectionOf(service.getCurrentBranchPr());
		expect(error).not.toBeInstanceOf(AppError);
	});
});

describe("fetchPrHead's resolved sha", () => {
	it("resolves with the fetched head sha for the port's callers", async () => {
		const origin = await createFixtureRepo();
		try {
			await origin.git(["checkout", "--quiet", "-b", "feature"]);
			await origin.write("head.txt", "content\n");
			const prHeadSha = await origin.commitAll("head commit");
			await origin.git(["update-ref", "refs/pull/34/head", prHeadSha]);
			await origin.git(["checkout", "--quiet", "main"]);
			const cloned = await origin.clone();
			try {
				const clonedService = new GhCliGithubService(
					new GitClient(cloned.root),
					cloned.root,
				);
				expect(await clonedService.fetchPrHead(34)).toBe(prHeadSha);
			} finally {
				await cloned.dispose();
			}
		} finally {
			await origin.dispose();
		}
	});
});

describe("findPendingReview", () => {
	it("returns the reviewer's own pending review when one exists", async () => {
		const pending = await service.findPendingReview(482);
		expect(pending).toEqual({
			id: 1001,
			htmlUrl: "https://github.com/acme/api/pull/482#pullrequestreview-1001",
			state: "PENDING",
		});
	});

	it("is null when nothing is pending", async () => {
		process.env.FAKE_GH_REVIEWS_JSON = "[]";
		expect(await service.findPendingReview(482)).toBeNull();
	});

	it("ignores reviews that are not pending", async () => {
		process.env.FAKE_GH_REVIEWS_JSON = JSON.stringify([
			{ id: 5, html_url: "https://example.invalid/5", state: "COMMENTED" },
		]);
		expect(await service.findPendingReview(482)).toBeNull();
	});
});

describe("createPendingReview", () => {
	it("creates a review and returns it, camelCasing the response", async () => {
		const created = await service.createPendingReview(482, {
			body: "overview",
			findings: [
				{ path: "src/limiter.ts", line: 3, side: "RIGHT", body: "note" },
			],
		});
		expect(created).toEqual({
			id: 1001,
			htmlUrl: "https://github.com/acme/api/pull/482#pullrequestreview-1001",
			state: "PENDING",
		});
	});

	it("sends the payload as snake_case JSON on stdin, event omitted", async () => {
		const logDirectory = await mkdtemp(join(tmpdir(), "prreview-ghlog-"));
		const logPath = join(logDirectory, "invocations.log");
		process.env.FAKE_GH_LOG = logPath;
		try {
			await service.createPendingReview(482, {
				findings: [
					{
						path: "src/limiter.ts",
						line: 4,
						side: "RIGHT",
						startLine: 3,
						startSide: "RIGHT",
						body: "range comment",
					},
				],
			});
			const [argv, stdin] = (await readFile(logPath, "utf8"))
				.trim()
				.split("\n");
			expect(argv).toBe(
				"api repos/{owner}/{repo}/pulls/482/reviews -X POST --input -",
			);
			expect(JSON.parse((stdin ?? "").replace(/^stdin /, ""))).toEqual({
				comments: [
					{
						path: "src/limiter.ts",
						line: 4,
						side: "RIGHT",
						start_line: 3,
						start_side: "RIGHT",
						body: "range comment",
					},
				],
			});
		} finally {
			await rm(logDirectory, { recursive: true, force: true });
		}
	});

	it("throws raw on a 422 (one bad comment kills the whole batch)", async () => {
		process.env.FAKE_GH_REVIEW_CREATE_EXIT = "22";
		const error = await rejectionOf(
			service.createPendingReview(482, {
				findings: [
					{ path: "src/limiter.ts", line: 999, side: "RIGHT", body: "x" },
				],
			}),
		);
		expect(error).not.toBeInstanceOf(AppError);
		expect(String((error as Error).cause)).toContain(
			"Line could not be resolved",
		);
	});
});

describe("deletePendingReview", () => {
	it("succeeds against a pending review", async () => {
		await expect(
			service.deletePendingReview(482, 1001),
		).resolves.toBeUndefined();
	});

	it("throws raw when the review cannot be deleted", async () => {
		process.env.FAKE_GH_REVIEW_DELETE_EXIT = "1";
		await expect(service.deletePendingReview(482, 1001)).rejects.toThrow();
	});
});
