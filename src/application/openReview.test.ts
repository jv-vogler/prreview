import { describe, expect, it } from "vitest";
import { buildTestContainer } from "../../test/helpers/buildTestContainer";
import type { ChangesetRef } from "../domain/changeset/ChangesetRef";
import { ChangesetError } from "../domain/errors/ChangesetError";
import { StoreError } from "../domain/errors/StoreError";
import { SCHEMA_VERSION } from "../domain/session/SCHEMA_VERSION";
import type { SessionManifest } from "../domain/session/SessionManifest";

function sha(letter: string): string {
	return letter.repeat(40);
}

const WORKTREE_DIFF = `diff --git a/src/limiter.ts b/src/limiter.ts
index 1111111..2222222 100644
--- a/src/limiter.ts
+++ b/src/limiter.ts
@@ -1,3 +1,4 @@
 export function limit() {
-  return false;
+  const allowed = bucket.take();
+  return allowed;
 }
`;

function worktreeWorld() {
	return buildTestContainer({
		git: {
			refs: { HEAD: sha("a") },
			fingerprint: "fp-1",
			worktreeDiff: WORKTREE_DIFF,
			gitCommonDir: "/repo/.git",
		},
		github: null,
	});
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
	try {
		await promise;
	} catch (error) {
		return error;
	}
	throw new Error("expected the promise to reject");
}

describe("creating a session", () => {
	it("opens round r1 with the parsed IR snapshot", async () => {
		const { container } = worktreeWorld();
		const opened = await container.openReview({ target: "working" });

		expect(opened.resumed).toBe(false);
		expect(opened.roundId).toBe("r1");
		expect(opened.manifest.schemaVersion).toBe(SCHEMA_VERSION);
		expect(opened.manifest.changesetId).toBe("worktree");
		expect(opened.manifest.currentRound).toBe("r1");
		expect(opened.manifest.source).toEqual({ kind: "worktree" });
		expect(opened.files).toHaveLength(1);
		expect(opened.files[0].path).toBe("src/limiter.ts");
		expect(opened.files[0].hunks).toHaveLength(1);
		expect(opened.coverage).toEqual({});
		expect(opened.announce.resolved).toContain("working tree");
	});

	it("persists the manifest and the round snapshot through the store", async () => {
		const { container, store } = worktreeWorld();
		await container.openReview({ target: "working" });

		expect(store.manifests.get("worktree")?.currentRound).toBe("r1");
		expect(await store.loadRoundChangeset("worktree", "r1")).not.toBeNull();
	});

	it("freezes the boot toolchain into the manifest", async () => {
		const { container, toolchain } = worktreeWorld();
		const opened = await container.openReview({ target: "working" });
		expect(opened.manifest.toolchain).toEqual(toolchain);
		expect(opened.manifest.engine.adapter).toBe(toolchain.agent.kind);
	});

	it("takes the session lock and registers .prreview/ in info/exclude", async () => {
		const { container, store } = worktreeWorld();
		await container.openReview({ target: "working" });
		expect(store.locks.has("worktree")).toBe(true);
		expect(store.excludedGitCommonDirs).toEqual(["/repo/.git"]);
	});

	it("a second server on the same session is refused as locked", async () => {
		const { container } = worktreeWorld();
		await container.openReview({ target: "working" });
		const error = await rejectionOf(
			container.openReview({ target: "working" }),
		);
		expect(error).toBeInstanceOf(StoreError);
		expect((error as StoreError).reason).toBe("locked");
	});

	it("a read-only checkout converts to ChangesetError('read-only-checkout')", async () => {
		const { container, store } = worktreeWorld();
		store.failWritesWith = Object.assign(
			new Error("EROFS: read-only file system"),
			{ code: "EROFS" },
		);
		const error = await rejectionOf(
			container.openReview({ target: "working" }),
		);
		expect(error).toBeInstanceOf(ChangesetError);
		expect((error as ChangesetError).reason).toBe("read-only-checkout");
	});
});

describe("resuming a session", () => {
	function storedRef(): ChangesetRef {
		return {
			source: { kind: "worktree" },
			baseSha: sha("a"),
			headSha: null,
			worktreeFingerprint: "fp-0",
			resolvedAt: "2026-08-14T00:00:00.000Z",
		};
	}

	function storedManifest(): SessionManifest {
		return {
			schemaVersion: SCHEMA_VERSION,
			changesetId: "worktree",
			source: { kind: "worktree" },
			toolchain: {
				agent: { kind: "claude", version: "2.0.0" },
				github: { kind: "gh" },
			},
			rounds: [{ id: "r1", ref: storedRef(), runs: [] }],
			currentRound: "r1",
			engine: { adapter: "claude", chatThreads: [] },
		};
	}

	it("returns the stored round, ref, and coverage — not a fresh parse", async () => {
		const setup = worktreeWorld();
		setup.store.manifests.set("worktree", storedManifest());
		setup.store.rounds.set("worktree r1", []);
		setup.store.coverageRecords.set("worktree", { hunk1: "reviewed" });

		const opened = await setup.container.openReview({ target: "working" });

		expect(opened.resumed).toBe(true);
		expect(opened.roundId).toBe("r1");
		// the stored ref, not the freshly observed one: the drift poller is
		// what compares stored vs live and raises the banner
		expect(opened.ref.worktreeFingerprint).toBe("fp-0");
		expect(opened.files).toEqual([]);
		expect(opened.coverage).toEqual({ hunk1: "reviewed" });
	});

	it("this boot's toolchain replaces the stored one", async () => {
		const setup = worktreeWorld();
		setup.store.manifests.set("worktree", storedManifest());
		setup.store.rounds.set("worktree r1", []);

		const opened = await setup.container.openReview({ target: "working" });

		expect(opened.manifest.toolchain).toEqual(setup.toolchain);
		expect(setup.store.manifests.get("worktree")?.toolchain).toEqual(
			setup.toolchain,
		);
	});

	it("a manifest whose current round snapshot is missing is corrupt", async () => {
		const setup = worktreeWorld();
		setup.store.manifests.set("worktree", storedManifest());

		const error = await rejectionOf(
			setup.container.openReview({ target: "working" }),
		);
		expect(error).toBeInstanceOf(StoreError);
		expect((error as StoreError).reason).toBe("corrupt");
	});
});
