import { describe, expect, it } from "vitest";
import { FakeGit } from "../../test/helpers/FakeGit";
import { InMemorySessionStore } from "../../test/helpers/InMemorySessionStore";
import { readBlobLines, splitLines } from "./blobContent";

const OID = "a".repeat(40);

function readers(
	state: {
		objectContents?: Record<string, string>;
		workingFiles?: Record<string, string>;
	} = {},
) {
	return { git: new FakeGit(state), store: new InMemorySessionStore() };
}

describe("splitLines", () => {
	it("numbers lines the way a diff prints them, ignoring the trailing newline", () => {
		expect(splitLines(Buffer.from("one\ntwo\n"))).toEqual(["one", "two"]);
		expect(splitLines(Buffer.from("one\ntwo"))).toEqual(["one", "two"]);
	});

	it("reads an empty file as no lines at all", () => {
		expect(splitLines(Buffer.from(""))).toEqual([]);
		expect(splitLines(Buffer.from("\n"))).toEqual([]);
	});

	it("keeps interior blank lines", () => {
		expect(splitLines(Buffer.from("one\n\nthree\n"))).toEqual([
			"one",
			"",
			"three",
		]);
	});
});

describe("readBlobLines", () => {
	it("reads an odb ref out of git's object database", async () => {
		const deps = readers({ objectContents: { [OID]: "one\ntwo\n" } });
		const result = await readBlobLines(deps, {
			ref: { kind: "odb", oid: OID },
		});
		expect(result).toMatchObject({ oid: OID, fromWorkingTree: false });
		expect(result?.lines).toEqual(["one", "two"]);
	});

	it("reads a worktree ref straight off the tree, flagged as such", async () => {
		const deps = readers({ workingFiles: { "a.ts": "one\n" } });
		const result = await readBlobLines(deps, {
			ref: { kind: "worktree", path: "a.ts", oid: OID },
		});
		expect(result).toMatchObject({ fromWorkingTree: true });
		expect(result?.lines).toEqual(["one"]);
	});

	it("falls back to the store when the object database has nothing", async () => {
		const deps = readers();
		await deps.store.writeBlob(OID, Buffer.from("stored\n"));
		const result = await readBlobLines(deps, {
			ref: { kind: "odb", oid: OID },
		});
		expect(result?.lines).toEqual(["stored"]);
		expect(result?.fromWorkingTree).toBe(false);
	});

	it("falls back to the working tree last, and only with a path to try", async () => {
		const withPath = readers({ workingFiles: { "a.ts": "on disk\n" } });
		expect(
			await readBlobLines(withPath, {
				ref: { kind: "odb", oid: OID },
				workingPath: "a.ts",
			}),
		).toMatchObject({ fromWorkingTree: true });

		expect(
			await readBlobLines(readers(), { ref: { kind: "odb", oid: OID } }),
		).toBeNull();
	});

	it("reports absence rather than throwing when nothing can be read", async () => {
		expect(
			await readBlobLines(readers(), {
				ref: { kind: "odb", oid: OID },
				workingPath: "gone.ts",
			}),
		).toBeNull();
	});
});
