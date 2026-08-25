import { describe, expect, it } from "vitest";
import { FakeGit } from "../../test/helpers/FakeGit";
import { FakeGithubService } from "../../test/helpers/FakeGithubService";
import type { ChangesetRef } from "../domain/changeset/ChangesetRef";
import { GithubError } from "../domain/errors/GithubError";
import { readChangesetFiles } from "./readChangesetFiles";

const PR_REF: ChangesetRef = {
	source: { kind: "pr", repo: "o/r", number: 7 },
	baseSha: "a".repeat(40),
	headSha: "b".repeat(40),
	resolvedAt: "2026-08-25T00:00:00.000Z",
};

describe("readChangesetFiles", () => {
	it("suggests stacked PRs when GitHub refuses the diff for size", async () => {
		const githubService = new FakeGithubService();
		githubService.getPrDiff = async () => {
			throw new Error(
				"gh api failed: diff exceeded the maximum number of lines (20000)",
			);
		};
		await expect(
			readChangesetFiles({ git: new FakeGit(), githubService }, PR_REF),
		).rejects.toMatchObject({
			reason: "diff-too-large",
			message: expect.stringContaining("smaller stacked PRs"),
		});
	});

	it("relays any other PR diff failure untranslated", async () => {
		const githubService = new FakeGithubService();
		const raw = new Error("gh: connection refused");
		githubService.getPrDiff = async () => {
			throw raw;
		};
		await expect(
			readChangesetFiles({ git: new FakeGit(), githubService }, PR_REF),
		).rejects.toBe(raw);
	});

	it("still parses a servable PR diff", async () => {
		const githubService = new FakeGithubService({
			prDiffs: {
				7: [
					"diff --git a/src/a.ts b/src/a.ts",
					"index 0000001..0000002 100644",
					"--- a/src/a.ts",
					"+++ b/src/a.ts",
					"@@ -1,1 +1,1 @@",
					"-old",
					"+new",
					"",
				].join("\n"),
			},
		});
		const files = await readChangesetFiles(
			{ git: new FakeGit(), githubService },
			PR_REF,
		);
		expect(files).toHaveLength(1);
		expect(files[0]?.path).toBe("src/a.ts");
	});

	it("keeps demanding a GitHub backend for a PR", async () => {
		await expect(
			readChangesetFiles({ git: new FakeGit(), githubService: null }, PR_REF),
		).rejects.toBeInstanceOf(GithubError);
	});
});
