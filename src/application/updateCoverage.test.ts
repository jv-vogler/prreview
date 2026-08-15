import { describe, expect, it } from "vitest";
import { buildTestContainer } from "../../test/helpers/buildTestContainer";

function sha(letter: string): string {
	return letter.repeat(40);
}

const TWO_FILE_DIFF = `diff --git a/a.ts b/a.ts
index 1111111..2222222 100644
--- a/a.ts
+++ b/a.ts
@@ -1,2 +1,2 @@
 const a = 1;
-const b = 2;
+const b = 3;
diff --git a/b.ts b/b.ts
index 3333333..4444444 100644
--- a/b.ts
+++ b/b.ts
@@ -1,2 +1,2 @@
 const x = 1;
-const y = 2;
+const y = 3;
`;

async function openedSession() {
	const setup = buildTestContainer({
		git: { refs: { HEAD: sha("a") }, worktreeDiff: TWO_FILE_DIFF },
		github: null,
	});
	const opened = await setup.container.openReview({ target: "working" });
	const [fileA, fileB] = opened.files;
	return {
		...setup,
		opened,
		hunkA: fileA.hunks[0].id,
		hunkB: fileB.hunks[0].id,
		fileAId: fileA.id,
		fileBId: fileB.id,
	};
}

describe("updateCoverage", () => {
	it("upserts a batch and returns the summary for the SSE event", async () => {
		const { container, opened, hunkA, fileAId, fileBId } =
			await openedSession();

		const result = await container.updateCoverage({
			changesetId: opened.manifest.changesetId,
			files: opened.files,
			coverage: opened.coverage,
			updates: [{ hunkId: hunkA, state: "viewed" }],
		});

		expect(result.coverage).toEqual({ [hunkA]: "viewed" });
		expect(result.summary.total).toBe(50);
		expect(result.summary.byFile[fileAId]).toBe(100);
		expect(result.summary.byFile[fileBId]).toBe(0);
	});

	it("is monotonic: viewed never downgrades a reviewed hunk", async () => {
		const { container, opened, hunkA } = await openedSession();
		const input = {
			changesetId: opened.manifest.changesetId,
			files: opened.files,
		};

		const reviewed = await container.updateCoverage({
			...input,
			coverage: opened.coverage,
			updates: [{ hunkId: hunkA, state: "reviewed" }],
		});
		const afterViewed = await container.updateCoverage({
			...input,
			coverage: reviewed.coverage,
			updates: [{ hunkId: hunkA, state: "viewed" }],
		});

		expect(afterViewed.coverage[hunkA]).toBe("reviewed");
	});

	it("drops hunkIds the current round does not know (a client racing a refresh)", async () => {
		const { container, opened } = await openedSession();

		const result = await container.updateCoverage({
			changesetId: opened.manifest.changesetId,
			files: opened.files,
			coverage: opened.coverage,
			updates: [{ hunkId: "stale-hunk-from-round-1", state: "viewed" }],
		});

		expect(result.coverage).toEqual({});
		expect(result.summary.total).toBe(0);
	});

	it("is idempotent: re-applying the same batch changes nothing", async () => {
		const { container, opened, hunkA } = await openedSession();
		const input = {
			changesetId: opened.manifest.changesetId,
			files: opened.files,
			updates: [{ hunkId: hunkA, state: "reviewed" as const }],
		};

		const first = await container.updateCoverage({
			...input,
			coverage: opened.coverage,
		});
		const second = await container.updateCoverage({
			...input,
			coverage: first.coverage,
		});

		expect(second.coverage).toEqual(first.coverage);
		expect(second.summary).toEqual(first.summary);
	});

	it("persists the new record through the store", async () => {
		const { container, store, opened, hunkA } = await openedSession();

		await container.updateCoverage({
			changesetId: opened.manifest.changesetId,
			files: opened.files,
			coverage: opened.coverage,
			updates: [{ hunkId: hunkA, state: "viewed" }],
		});

		expect(store.coverageRecords.get("worktree")).toEqual({
			[hunkA]: "viewed",
		});
	});
});
