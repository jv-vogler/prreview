import gitDiffParser from "gitdiff-parser";
import { describe, expect, it } from "vitest";
import { FakeGit } from "../../test/helpers/FakeGit";
import { InMemorySessionStore } from "../../test/helpers/InMemorySessionStore";
import { captureSnapshot } from "../domain/anchor/captureSnapshot";
import type { StoredAnnotation } from "../domain/annotation/Annotation";
import type { FileDiff } from "../domain/changeset/FileDiff";
import { parseDiff } from "../domain/changeset/parseDiff";
import { deltaHunkSets, reanchorAnnotations } from "./reanchorAnnotations";

const ROUND_1_NEW_OID = "1".repeat(40);
const ROUND_2_NEW_OID = "2".repeat(40);
const BASE_OID = "3".repeat(40);

const ROUND_1_CONTENT = [
	"const header = 1;",
	"export function compute(value: number) {",
	"  return value * 2;",
	"}",
].join("\n");

/** the target line moved down by two: a pure shift re-anchoring must follow */
const ROUND_2_CONTENT = [
	"const header = 1;",
	"const extra = 0;",
	"const alsoExtra = 0;",
	"export function compute(value: number) {",
	"  return value * 2;",
	"}",
].join("\n");

/** the target line is gone: the note has nothing left to describe */
const ROUND_2_WITHOUT_TARGET = [
	"const header = 1;",
	"export function compute(value: number) {",
	"}",
].join("\n");

function diffFor(newOid: string, addedLines: string[]): FileDiff[] {
	const body = addedLines.map((line) => `+${line}`).join("\n");
	return parseDiff(
		gitDiffParser.parse(
			`diff --git a/src/compute.ts b/src/compute.ts
index ${BASE_OID}..${newOid} 100644
--- a/src/compute.ts
+++ b/src/compute.ts
@@ -1,1 +1,${1 + addedLines.length} @@
 const header = 1;
${body}
`,
		),
	);
}

function annotationOn(lines: string[], startLine: number): StoredAnnotation {
	return {
		id: "01ANNOTATION",
		species: "explanation",
		anchor: {
			fileId: "F1",
			path: "src/compute.ts",
			side: "new",
			startLine,
			endLine: startLine,
			placement: "in-file",
			snapshot: captureSnapshot(lines, startLine, startLine, ROUND_1_NEW_OID),
		},
		anchorStatus: "anchored",
		body: "doubling is the whole point of this function",
		category: "mechanism",
		provenance: {
			roundId: "r1",
			stage: "comprehension",
			engineSessionId: "session-A",
		},
		createdAt: "2026-08-17T10:00:00.000Z",
	};
}

function readers(objectContents: Record<string, string>) {
	return {
		git: new FakeGit({ objectContents }),
		store: new InMemorySessionStore(),
	};
}

const ROUND_1_LINES = ROUND_1_CONTENT.split("\n");

describe("deltaHunkSets", () => {
	it("splits hunkIds into unchanged, changed, and removed", () => {
		const previous = diffFor(ROUND_1_NEW_OID, ["const extra = 0;"]);
		const next = diffFor(ROUND_2_NEW_OID, ["const different = 9;"]);

		const delta = deltaHunkSets(previous, next);
		expect([...delta.unchanged]).toEqual([]);
		expect([...delta.changed]).toEqual(next[0].hunks.map((hunk) => hunk.id));
		expect([...delta.removed]).toEqual(
			previous[0].hunks.map((hunk) => hunk.id),
		);
	});

	it("reports an identical round as wholly unchanged", () => {
		const files = diffFor(ROUND_1_NEW_OID, ["const extra = 0;"]);
		const delta = deltaHunkSets(files, files);
		expect(delta.unchanged.size).toBe(1);
		expect(delta.changed.size).toBe(0);
		expect(delta.removed.size).toBe(0);
	});
});

describe("reanchorAnnotations", () => {
	it("carries an explanation onto its new line when the code shifted", async () => {
		const previous = diffFor(ROUND_1_NEW_OID, ["export function compute…"]);
		const next = diffFor(ROUND_2_NEW_OID, [
			"const extra = 0;",
			"const alsoExtra = 0;",
		]);
		const deps = readers({
			[ROUND_1_NEW_OID]: ROUND_1_CONTENT,
			[ROUND_2_NEW_OID]: ROUND_2_CONTENT,
		});

		const triage = await reanchorAnnotations(deps, {
			annotations: [annotationOn(ROUND_1_LINES, 3)],
			previousFiles: previous,
			nextFiles: next,
		});

		expect(triage.retired).toEqual([]);
		expect(triage.carried).toHaveLength(1);
		expect(triage.carried[0].anchor).toMatchObject({
			startLine: 5,
			endLine: 5,
			path: "src/compute.ts",
		});
		expect(triage.carried[0].anchorStatus).toBe("moved");
		expect(triage.carried[0].anchor.snapshot.blobOid).toBe(ROUND_2_NEW_OID);
	});

	it("carries an untouched target silently, with no delta flag", async () => {
		const files = diffFor(ROUND_1_NEW_OID, ["const extra = 0;"]);
		const deps = readers({ [ROUND_1_NEW_OID]: ROUND_1_CONTENT });

		const triage = await reanchorAnnotations(deps, {
			annotations: [annotationOn(ROUND_1_LINES, 3)],
			previousFiles: files,
			nextFiles: files,
		});

		expect(triage.carried[0].anchorStatus).toBe("anchored");
		expect(triage.carried[0].touchedByDelta).toBeUndefined();
	});

	it("flags a carried explanation whose target now sits in new work", async () => {
		const previous = diffFor(ROUND_1_NEW_OID, ["const extra = 0;"]);
		// the new round's hunk covers lines 1–3, so the anchored line is inside
		// the delta the refresh introduced
		const next = diffFor(ROUND_2_NEW_OID, [
			"const extra = 0;",
			"const alsoExtra = 0;",
		]);
		const deps = readers({
			[ROUND_1_NEW_OID]: ROUND_1_CONTENT,
			[ROUND_2_NEW_OID]: ROUND_2_CONTENT,
		});

		const triage = await reanchorAnnotations(deps, {
			annotations: [annotationOn(ROUND_1_LINES, 1)],
			previousFiles: previous,
			nextFiles: next,
		});

		expect(triage.carried).toHaveLength(1);
		expect(triage.carried[0].touchedByDelta).toBe(true);
	});

	it("retires an explanation whose lines are gone", async () => {
		const previous = diffFor(ROUND_1_NEW_OID, ["const extra = 0;"]);
		const next = diffFor(ROUND_2_NEW_OID, ["const extra = 0;"]);
		const deps = readers({
			[ROUND_1_NEW_OID]: ROUND_1_CONTENT,
			[ROUND_2_NEW_OID]: ROUND_2_WITHOUT_TARGET,
		});

		const triage = await reanchorAnnotations(deps, {
			annotations: [annotationOn(ROUND_1_LINES, 3)],
			previousFiles: previous,
			nextFiles: next,
		});

		expect(triage.carried).toEqual([]);
		expect(triage.retired).toEqual(["01ANNOTATION"]);
	});

	it("retires an explanation whose file left the changeset", async () => {
		const previous = diffFor(ROUND_1_NEW_OID, ["const extra = 0;"]);
		const deps = readers({ [ROUND_1_NEW_OID]: ROUND_1_CONTENT });

		const triage = await reanchorAnnotations(deps, {
			annotations: [annotationOn(ROUND_1_LINES, 3)],
			previousFiles: previous,
			nextFiles: [],
		});

		expect(triage.retired).toEqual(["01ANNOTATION"]);
	});

	it("retires an explanation whose old side can no longer be read", async () => {
		const previous = diffFor(ROUND_1_NEW_OID, ["const extra = 0;"]);
		const next = diffFor(ROUND_2_NEW_OID, ["const extra = 0;"]);
		const deps = readers({ [ROUND_2_NEW_OID]: ROUND_2_CONTENT });

		const triage = await reanchorAnnotations(deps, {
			annotations: [annotationOn(ROUND_1_LINES, 3)],
			previousFiles: previous,
			nextFiles: next,
		});

		expect(triage.retired).toEqual(["01ANNOTATION"]);
	});

	it("does nothing at all when there are no annotations", async () => {
		const deps = readers({});
		expect(
			await reanchorAnnotations(deps, {
				annotations: [],
				previousFiles: [],
				nextFiles: [],
			}),
		).toEqual({ carried: [], retired: [] });
	});

	it("reads the persisted worktree snapshot when the object database has nothing", async () => {
		const previous = diffFor(ROUND_1_NEW_OID, ["const extra = 0;"]);
		const next = diffFor(ROUND_2_NEW_OID, ["const extra = 0;"]);
		const deps = readers({ [ROUND_2_NEW_OID]: ROUND_2_CONTENT });
		await deps.store.writeBlob(ROUND_1_NEW_OID, Buffer.from(ROUND_1_CONTENT));

		const triage = await reanchorAnnotations(deps, {
			annotations: [annotationOn(ROUND_1_LINES, 3)],
			previousFiles: previous,
			nextFiles: next,
		});

		expect(triage.retired).toEqual([]);
		expect(triage.carried[0].anchor.startLine).toBe(5);
	});

	it("is deterministic: the same rounds twice yield the same anchors", async () => {
		const previous = diffFor(ROUND_1_NEW_OID, ["const extra = 0;"]);
		const next = diffFor(ROUND_2_NEW_OID, ["const extra = 0;"]);
		const objects = {
			[ROUND_1_NEW_OID]: ROUND_1_CONTENT,
			[ROUND_2_NEW_OID]: ROUND_2_CONTENT,
		};
		const input = {
			annotations: [annotationOn(ROUND_1_LINES, 3)],
			previousFiles: previous,
			nextFiles: next,
		};

		const first = await reanchorAnnotations(readers(objects), input);
		const second = await reanchorAnnotations(readers(objects), input);
		expect(second).toEqual(first);
	});
});
