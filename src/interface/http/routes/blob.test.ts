import { afterAll, describe, expect, it } from "vitest";
import { buildTestContainer } from "../../../../test/helpers/buildTestContainer";
import {
	createFixtureRepo,
	type FixtureRepo,
} from "../../../../test/helpers/createFixtureRepo";
import { stubReviewRunner } from "../../../../test/helpers/stubReviewRunner";
import type { FileDiff } from "../../../domain/changeset/FileDiff";
import { createApp } from "../app";
import { createSseHub } from "../events/sseHub";
import type { CurrentChangeset } from "../reviewState";
import { createReviewState } from "../reviewState";

const disposables: FixtureRepo[] = [];
afterAll(async () => {
	await Promise.all(disposables.map((repo) => repo.dispose()));
});

function fileNamed(path: string): FileDiff {
	return {
		id: `f_${path}`,
		path,
		status: "modified",
		additions: 0,
		deletions: 0,
		isBinary: false,
		isGenerated: false,
		oldBlob: null,
		newBlob: null,
		hunks: [],
	};
}

/** The full app, so the AppError -> ErrorDto onError edge is in effect (production behavior). */
async function fixtureApp(files: FileDiff[]) {
	const repo = await createFixtureRepo();
	disposables.push(repo);
	const { container } = buildTestContainer({ repoRoot: repo.root });
	const current: CurrentChangeset = {
		ref: {
			source: { kind: "worktree" },
			baseSha: "a".repeat(40),
			headSha: null,
			resolvedAt: new Date(0).toISOString(),
		},
		announce: { resolved: "x", overrideHint: "x" },
		files,
	};
	const state = createReviewState(current, async () => current);
	const app = createApp({
		container,
		state,
		runner: stubReviewRunner(),
		hub: createSseHub(),
		repoRoot: repo.root,
		clientDir: null,
	});
	return { repo, app };
}

describe("hostile paths", () => {
	it.each([
		["../outside.txt", "path escaping via .."],
		["/etc/passwd", "an absolute path"],
		["C:\\Windows", "a windows drive path"],
		["a\\b", "a backslash"],
	])("rejects %s (%s)", async (path) => {
		const { app } = await fixtureApp([fileNamed(path)]);
		const response = await app.request(
			`/api/blob?ref=WORKING&path=${encodeURIComponent(path)}`,
		);
		expect(response.status).toBe(400);
	});

	it("rejects a NUL byte in the path", async () => {
		const { app } = await fixtureApp([]);
		const response = await app.request("/api/blob?ref=WORKING&path=a%00b");
		expect(response.status).toBe(400);
	});

	it("rejects an unrecognized ref", async () => {
		const { app } = await fixtureApp([fileNamed("a.txt")]);
		const response = await app.request("/api/blob?ref=not-a-sha&path=a.txt");
		expect(response.status).toBe(400);
	});
});

describe("changeset allowlist", () => {
	it("404s a path the changeset does not mention", async () => {
		const { app } = await fixtureApp([fileNamed("a.txt")]);
		const response = await app.request("/api/blob?ref=WORKING&path=b.txt");
		expect(response.status).toBe(404);
	});
});

describe("WORKING ref", () => {
	it("serves the working tree's current bytes for an allowlisted path", async () => {
		const { repo, app } = await fixtureApp([fileNamed("hello.txt")]);
		await repo.write("hello.txt", "hi there\n");
		const response = await app.request("/api/blob?ref=WORKING&path=hello.txt");
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			name: "hello.txt",
			contents: "hi there\n",
		});
	});

	it("415s binary content", async () => {
		const { repo, app } = await fixtureApp([fileNamed("blob.bin")]);
		await repo.write("blob.bin", Buffer.from([0, 1, 2, 0, 3]));
		const response = await app.request("/api/blob?ref=WORKING&path=blob.bin");
		expect(response.status).toBe(415);
	});

	it("404s a file that does not exist on disk despite being allowlisted", async () => {
		const { app } = await fixtureApp([fileNamed("ghost.txt")]);
		const response = await app.request("/api/blob?ref=WORKING&path=ghost.txt");
		expect(response.status).toBe(404);
	});
});
