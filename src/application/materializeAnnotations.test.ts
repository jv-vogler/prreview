import gitDiffParser from "gitdiff-parser";
import { describe, expect, it } from "vitest";
import { FakeGit, type FakeGitState } from "../../test/helpers/FakeGit";
import { InMemorySessionStore } from "../../test/helpers/InMemorySessionStore";
import type { FileDiff } from "../domain/changeset/FileDiff";
import { parseDiff } from "../domain/changeset/parseDiff";
import type { ComprehensionOut } from "./analysis/schemas";
import { materializeAnnotations } from "./materializeAnnotations";

const OLD_OID = "1".repeat(40);
const NEW_OID = "2".repeat(40);

const GREETING_NEW = [
	"export function greet(name: string, excited = false) {",
	'  const base = "hello, " + name;',
	'  return excited ? base + "!" : base;',
	"}",
].join("\n");

const GREETING_OLD = [
	"export function greet(name: string) {",
	'  return "hello, " + name;',
	"}",
].join("\n");

const DIFF = `diff --git a/src/greeting.ts b/src/greeting.ts
index ${OLD_OID}..${NEW_OID} 100644
--- a/src/greeting.ts
+++ b/src/greeting.ts
@@ -1,3 +1,4 @@
-export function greet(name: string) {
-  return "hello, " + name;
+export function greet(name: string, excited = false) {
+  const base = "hello, " + name;
+  return excited ? base + "!" : base;
 }
`;

function files(): FileDiff[] {
	return parseDiff(gitDiffParser.parse(DIFF));
}

function deps(state: FakeGitState = {}) {
	const git = new FakeGit({
		objectContents: {
			[OLD_OID]: GREETING_OLD,
			[NEW_OID]: GREETING_NEW,
		},
		...state,
	});
	const store = new InMemorySessionStore();
	return { git, store };
}

function explanation(
	anchor: ComprehensionOut["explanations"][number]["anchor"],
	body = "the signature gained an optional flag",
): ComprehensionOut["explanations"][number] {
	return { anchor, kind: "intent", body };
}

const PROVENANCE = {
	roundId: "r1",
	stage: "comprehension",
	engineSessionId: "session-1",
};

const CREATED_AT = "2026-08-17T10:00:00.000Z";

async function materialize(
	explanations: ComprehensionOut["explanations"],
	overrides: { files?: FileDiff[]; deps?: ReturnType<typeof deps> } = {},
) {
	const dependencies = overrides.deps ?? deps();
	const result = await materializeAnnotations(dependencies, {
		explanations,
		files: overrides.files ?? files(),
		provenance: PROVENANCE,
		createdAt: CREATED_AT,
	});
	return { ...result, ...dependencies };
}

describe("materializeAnnotations", () => {
	it("builds a stored explanation with a snapshot, a computed placement, and provenance", async () => {
		const { annotations, skippedAnchors } = await materialize([
			explanation({
				path: "src/greeting.ts",
				side: "new",
				startLine: 1,
				endLine: 1,
			}),
		]);

		expect(skippedAnchors).toBe(0);
		expect(annotations).toHaveLength(1);
		const [annotation] = annotations;
		expect(annotation.species).toBe("explanation");
		expect(annotation.category).toBe("intent");
		expect(annotation.anchorStatus).toBe("anchored");
		expect(annotation.provenance).toEqual(PROVENANCE);
		expect(annotation.createdAt).toBe(CREATED_AT);
		expect(annotation.anchor).toMatchObject({
			path: "src/greeting.ts",
			side: "new",
			startLine: 1,
			endLine: 1,
			// line 1 is an added line, so it belongs to the hunk
			placement: "in-diff",
		});
		expect(annotation.anchor.fileId).toBe(files()[0].id);
		expect(annotation.anchor.snapshot.blobOid).toBe(NEW_OID);
		expect(annotation.anchor.snapshot.targetLines).toEqual([
			"export function greet(name: string, excited = false) {",
		]);
		expect(annotation.anchor.snapshot.contextAfter[0]).toBe(
			'const base = "hello, " + name;',
		);
	});

	it("ids are unique per annotation", async () => {
		const { annotations } = await materialize([
			explanation({
				path: "src/greeting.ts",
				side: "new",
				startLine: 1,
				endLine: 1,
			}),
			explanation({
				path: "src/greeting.ts",
				side: "new",
				startLine: 3,
				endLine: 3,
			}),
		]);
		expect(new Set(annotations.map((annotation) => annotation.id)).size).toBe(
			2,
		);
	});

	it("anchors on the old side by the path that side had", async () => {
		const { annotations } = await materialize([
			explanation({
				path: "src/greeting.ts",
				side: "old",
				startLine: 2,
				endLine: 2,
			}),
		]);
		expect(annotations[0].anchor.side).toBe("old");
		expect(annotations[0].anchor.snapshot.blobOid).toBe(OLD_OID);
		expect(annotations[0].anchor.snapshot.targetLines).toEqual([
			'return "hello, " + name;',
		]);
	});

	it("keeps a file-level 0/0 anchor as file-level", async () => {
		const { annotations } = await materialize([
			explanation({
				path: "src/greeting.ts",
				side: "new",
				startLine: 0,
				endLine: 0,
			}),
		]);
		expect(annotations[0].anchor.placement).toBe("file-level");
		expect(annotations[0].anchor.snapshot.targetLines).toEqual([]);
	});

	it("clamps a range that runs past the end of the file", async () => {
		const { annotations } = await materialize([
			explanation({
				path: "src/greeting.ts",
				side: "new",
				startLine: 3,
				endLine: 900,
			}),
		]);
		expect(annotations[0].anchor).toMatchObject({ startLine: 3, endLine: 4 });
	});

	it("drops an anchor naming a path the changeset does not contain", async () => {
		const { annotations, skippedAnchors } = await materialize([
			explanation({
				path: "src/nowhere.ts",
				side: "new",
				startLine: 1,
				endLine: 1,
			}),
		]);
		expect(annotations).toEqual([]);
		expect(skippedAnchors).toBe(1);
	});

	it("drops an empty range instead of placing it at line 0", async () => {
		const { annotations, skippedAnchors } = await materialize([
			explanation({
				path: "src/greeting.ts",
				side: "new",
				startLine: 4,
				endLine: 2,
			}),
		]);
		expect(annotations).toEqual([]);
		expect(skippedAnchors).toBe(1);
	});

	it("drops an anchor whose side cannot be read anywhere", async () => {
		const dependencies = deps({ objectContents: {} });
		const { annotations, skippedAnchors } = await materialize(
			[
				explanation({
					path: "src/greeting.ts",
					side: "new",
					startLine: 1,
					endLine: 1,
				}),
			],
			{ deps: dependencies },
		);
		expect(annotations).toEqual([]);
		expect(skippedAnchors).toBe(1);
	});

	it("falls back to the working tree and snapshots it, so a later round can still re-anchor", async () => {
		// a worktree changeset's new side is a blob git hashed but never wrote
		const dependencies = deps({
			objectContents: { [OLD_OID]: GREETING_OLD },
			workingFiles: { "src/greeting.ts": GREETING_NEW },
		});
		const { annotations, store } = await materialize(
			[
				explanation({
					path: "src/greeting.ts",
					side: "new",
					startLine: 1,
					endLine: 1,
				}),
			],
			{ deps: dependencies },
		);

		expect(annotations).toHaveLength(1);
		expect(store.blobs.get(NEW_OID)?.toString("utf8")).toBe(GREETING_NEW);
	});

	it("reads each side once even for many explanations", async () => {
		const dependencies = deps();
		let objectReads = 0;
		const readObject = dependencies.git.readObject.bind(dependencies.git);
		dependencies.git.readObject = async (oid: string) => {
			objectReads += 1;
			return readObject(oid);
		};

		await materialize(
			[
				explanation({
					path: "src/greeting.ts",
					side: "new",
					startLine: 1,
					endLine: 1,
				}),
				explanation({
					path: "src/greeting.ts",
					side: "new",
					startLine: 3,
					endLine: 3,
				}),
				explanation({
					path: "src/greeting.ts",
					side: "old",
					startLine: 1,
					endLine: 1,
				}),
			],
			{ deps: dependencies },
		);
		expect(objectReads).toBe(2);
	});
});
