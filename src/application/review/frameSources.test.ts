import { describe, expect, it } from "vitest";
import { FakeGit } from "../../../test/helpers/FakeGit";
import type { ChangesetRef } from "../../domain/changeset/ChangesetRef";
import type { FileDiff } from "../../domain/changeset/FileDiff";
import { readFrameSources } from "./frameSources";

/**
 * Reading the frame's sources out of the repository, at the revision under
 * review.
 *
 * Two properties matter more than the rest: a missing file is normal, and the
 * revision is the reviewed one rather than whatever is checked out. Both used
 * to be moot because nothing read anything.
 */

const HEAD = "b".repeat(40);

function refAt(headSha: string | null): ChangesetRef {
	return {
		source:
			headSha === null
				? { kind: "worktree" }
				: { kind: "range", from: "a", to: "b" },
		baseSha: "a".repeat(40),
		headSha,
		resolvedAt: "2026-08-19T00:00:00.000Z",
	};
}

function fileAt(path: string): FileDiff {
	return {
		id: `F-${path}`,
		path,
		status: "modified",
		additions: 1,
		deletions: 0,
		isBinary: false,
		isGenerated: false,
		oldBlob: null,
		newBlob: null,
		hunks: [],
	};
}

describe("readFrameSources", () => {
	it("reads the sources at the reviewed commit, not the checkout", async () => {
		const git = new FakeGit({
			blobs: {
				[`${HEAD}:README.md`]: "The reviewed revision's README.",
				[`${HEAD}:CLAUDE.md`]: "Conventions as of this commit.",
				[`${HEAD}:package.json`]: '{"devDependencies":{"vitest":"^4"}}',
			},
			// the working tree has moved on; none of this may leak into the frame
			workingFiles: { "README.md": "a much later README" },
		});

		const sources = await readFrameSources(
			{ git },
			{ ref: refAt(HEAD), files: [fileAt("src/a.ts")] },
		);

		expect(sources.readme).toBe("The reviewed revision's README.");
		expect(sources.conventions).toBe("Conventions as of this commit.");
		expect(sources.manifest).toContain("vitest");
	});

	/**
	 * The working-tree changeset has no commit to read from — the working copy
	 * *is* the revision under review.
	 */
	it("falls back to the working tree when there is no head commit", async () => {
		const git = new FakeGit({
			workingFiles: {
				"README.md": "what is on disk right now",
				"AGENTS.md": "house rules",
			},
		});

		const sources = await readFrameSources(
			{ git },
			{ ref: refAt(null), files: [fileAt("src/a.ts")] },
		);

		expect(sources.readme).toBe("what is on disk right now");
		expect(sources.conventions).toBe("house rules");
	});

	/**
	 * `Git.readBlob` rejects raw on a path that does not exist (CON-003). One
	 * missing README must not cost the run its whole frame, which is what a
	 * single try/catch around all three sources would do.
	 */
	it("keeps the sources that exist when one is missing", async () => {
		const git = new FakeGit({
			blobs: { [`${HEAD}:package.json`]: '{"devDependencies":{"biome":"^2"}}' },
		});

		const sources = await readFrameSources(
			{ git },
			{ ref: refAt(HEAD), files: [fileAt("src/a.ts")] },
		);

		expect(sources.readme).toBeUndefined();
		expect(sources.conventions).toBeUndefined();
		expect(sources.manifest).toContain("biome");
	});

	it("resolves with nothing at all rather than failing on an empty repo", async () => {
		const sources = await readFrameSources(
			{ git: new FakeGit() },
			{ ref: refAt(HEAD), files: [] },
		);

		expect(sources.readme).toBeUndefined();
		expect(sources.conventions).toBeUndefined();
		expect(sources.manifest).toBeUndefined();
		expect(sources.tree).toEqual([]);
	});

	it("prefers CLAUDE.md over AGENTS.md when both exist", async () => {
		const git = new FakeGit({
			blobs: {
				[`${HEAD}:CLAUDE.md`]: "the one Claude reads",
				[`${HEAD}:AGENTS.md`]: "the generic one",
			},
		});

		const sources = await readFrameSources(
			{ git },
			{ ref: refAt(HEAD), files: [] },
		);

		expect(sources.conventions).toBe("the one Claude reads");
	});

	/** a file that exists and is empty is the same as no file */
	it("skips an empty candidate and keeps looking", async () => {
		const git = new FakeGit({
			blobs: {
				[`${HEAD}:README.md`]: "   \n",
				[`${HEAD}:README`]: "the real one",
			},
		});

		const sources = await readFrameSources(
			{ git },
			{ ref: refAt(HEAD), files: [] },
		);

		expect(sources.readme).toBe("the real one");
	});

	/**
	 * The layout comes from the change's own paths: `git ls-tree` would describe
	 * the whole repository and needs a port method that does not exist, and the
	 * section's only job is telling the agent where things sit.
	 */
	it("derives the layout from the changed paths, two levels deep", async () => {
		const sources = await readFrameSources(
			{ git: new FakeGit() },
			{
				ref: refAt(HEAD),
				files: [
					fileAt("src/application/runReview.ts"),
					fileAt("src/application/review/adjudicate.ts"),
					fileAt("src/domain/review/formGate.ts"),
					fileAt("README.md"),
				],
			},
		);

		expect(sources.tree).toEqual([
			"(repo root)",
			"src/application/",
			"src/domain/",
		]);
	});
});
