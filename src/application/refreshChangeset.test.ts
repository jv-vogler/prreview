import { describe, expect, it } from "vitest";
import { buildTestContainer } from "../../test/helpers/buildTestContainer";

function sha(letter: string): string {
	return letter.repeat(40);
}

const HUNK_A = `diff --git a/a.ts b/a.ts
index 1111111..2222222 100644
--- a/a.ts
+++ b/a.ts
@@ -1,2 +1,2 @@
 const a = 1;
-const b = 2;
+const b = 3;
`;

const HUNK_B = `diff --git a/b.ts b/b.ts
index 3333333..4444444 100644
--- a/b.ts
+++ b/b.ts
@@ -1,2 +1,2 @@
 const x = 1;
-const y = 2;
+const y = 3;
`;

const HUNK_C = `diff --git a/c.ts b/c.ts
index 5555555..6666666 100644
--- a/c.ts
+++ b/c.ts
@@ -1,2 +1,2 @@
 const p = 1;
-const q = 2;
+const q = 3;
`;

const ROUND_1_DIFF = HUNK_A + HUNK_B;
const ROUND_2_DIFF = HUNK_A + HUNK_C;

function hunkIdOf(
	files: readonly { path: string; hunks: readonly { id: string }[] }[],
	path: string,
): string {
	const file = files.find((candidate) => candidate.path === path);
	if (file === undefined || file.hunks.length === 0) {
		throw new Error(`no hunks parsed for ${path}`);
	}
	return file.hunks[0].id;
}

async function openedWorktreeSession() {
	const setup = buildTestContainer({
		git: {
			refs: { HEAD: sha("a") },
			fingerprint: "fp-1",
			worktreeDiff: ROUND_1_DIFF,
		},
		github: null,
	});
	const opened = await setup.container.openReview({ target: "working" });
	return { ...setup, opened };
}

describe("refreshChangeset", () => {
	it("opens round r2 on the re-resolved ref with a fresh snapshot", async () => {
		const { container, git, opened } = await openedWorktreeSession();
		git.state.worktreeDiff = ROUND_2_DIFF;
		git.state.fingerprint = "fp-2";

		const refreshed = await container.refreshChangeset({
			manifest: opened.manifest,
			coverage: opened.coverage,
		});

		expect(refreshed.roundId).toBe("r2");
		expect(refreshed.manifest.currentRound).toBe("r2");
		expect(refreshed.manifest.rounds.map((round) => round.id)).toEqual([
			"r1",
			"r2",
		]);
		expect(refreshed.ref.worktreeFingerprint).toBe("fp-2");
		expect(refreshed.files.map((file) => file.path)).toEqual(["a.ts", "c.ts"]);
		// identity never changes mid-session
		expect(refreshed.manifest.changesetId).toBe(opened.manifest.changesetId);
	});

	it("carries coverage as a hunkId intersection, so the total honestly drops", async () => {
		const { container, git, opened } = await openedWorktreeSession();
		const hunkA = hunkIdOf(opened.files, "a.ts");
		const hunkB = hunkIdOf(opened.files, "b.ts");
		const { coverage } = await container.updateCoverage({
			changesetId: opened.manifest.changesetId,
			files: opened.files,
			coverage: opened.coverage,
			updates: [
				{ hunkId: hunkA, state: "viewed" },
				{ hunkId: hunkB, state: "reviewed" },
			],
		});

		git.state.worktreeDiff = ROUND_2_DIFF;
		const refreshed = await container.refreshChangeset({
			manifest: opened.manifest,
			coverage,
		});

		// a.ts survived byte-identical → same content-derived hunkId → carried
		expect(refreshed.coverage).toEqual({ [hunkA]: "viewed" });
		// c.ts is new work: absent from coverage means unseen
		const hunkC = hunkIdOf(refreshed.files, "c.ts");
		expect(refreshed.coverage[hunkC]).toBeUndefined();
	});

	it("persists the new round, manifest, and carried coverage", async () => {
		const { container, store, git, opened } = await openedWorktreeSession();
		git.state.worktreeDiff = ROUND_2_DIFF;

		const refreshed = await container.refreshChangeset({
			manifest: opened.manifest,
			coverage: opened.coverage,
		});

		expect(store.manifests.get("worktree")?.currentRound).toBe("r2");
		expect(await store.loadRoundChangeset("worktree", "r2")).toEqual(
			refreshed.files,
		);
		expect(store.coverageRecords.get("worktree")).toEqual(refreshed.coverage);
	});
});
